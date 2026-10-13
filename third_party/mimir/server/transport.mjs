// MethodAtlas adaptation of Mimir's SSH transport.
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
const teamCredentials = process.env.METHODATLAS_TEAM_SSH === undefined ? null : JSON.parse(process.env.METHODATLAS_TEAM_SSH)
const exec = promisify(execFile)
const runner = await readFile(new URL('./remote-runner.py', import.meta.url), 'utf8')
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"

// Opt-in local CPU validation. The existing runner still enforces group isolation.
export const isLocalTarget = server => teamCredentials === null && server.host === 'methodatlas-local'
export function dockerArgs() {
  const socket = process.env.METHODATLAS_DOCKER_HOST || ''
  if (/[\0\r\n]/.test(socket) || !(/^unix:\/\/\/.+$/.test(socket) || /^npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_.-]+$/.test(socket)) || !process.env.METHODATLAS_LOCAL_CONTAINER) throw new Error('本机实验需要显式配置本地 Docker socket（Unix 或 Windows 命名管道）和专用容器')
  return ['--host', socket]
}

export function sshArgs(server) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(server.host) ||
      server.username && !/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(server.username) ||
      server.port != null && (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535)) throw new Error('Invalid SSH target')
  let isolated = []
  if (teamCredentials !== null) {
    const credential = Object.hasOwn(teamCredentials, server.id) && teamCredentials[server.id]
    const folder = credential?.folder
    if (typeof folder !== 'string' || !server.username || !server.port ||
        ['host', 'port', 'username'].some(field => credential.target?.[field] !== server[field])) throw new Error('Team SSH credentials are required for this target')
    const knownHosts = join(folder, 'known_hosts').replaceAll('\\', '/')
    if (/["\r\n\0]/.test(knownHosts)) throw new Error('Invalid credential path')
    isolated = ['-F', 'none', '-i', join(folder, 'identity'),
      '-o', `UserKnownHostsFile="${knownHosts}"`, '-o', 'GlobalKnownHostsFile=none',
      '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-o', 'AddKeysToAgent=no',
      '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no',
      '-o', 'ForwardAgent=no', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none',
      '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'UpdateHostKeys=no']
  }
  return [...isolated, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
    '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', '-o', 'RequestTTY=no',
    ...(server.port == null ? [] : ['-p', String(server.port)]), ...(server.username ? ['-l', server.username] : []), '--', server.host]
}

export async function probeTarget(server) {
  if (isLocalTarget(server)) {
    const args = dockerArgs()
    const {stdout} = await exec('docker', [...args, 'inspect', process.env.METHODATLAS_LOCAL_CONTAINER], {timeout:8000, maxBuffer:128*1024})
    const [container] = JSON.parse(stdout)
    if (!container?.State?.Running || container.Mounts.length || container.HostConfig.Privileged || container.HostConfig.NetworkMode !== 'none') throw new Error('本机验收容器须运行、无主机挂载、非 privileged 且禁用网络')
    return {host:'methodatlas-local', port:0, username:'', containerId:container.Id,
      configDigest:createHash('sha256').update(JSON.stringify([args, container.Id, container.Image, container.HostConfig])).digest('hex')}
  }
  const { stdout } = await exec('ssh', ['-G', ...sshArgs(server)], {timeout: 8000, maxBuffer: 128 * 1024})
  const fields = Object.fromEntries(stdout.split('\n').map(line => { const i = line.indexOf(' '); return [line.slice(0, i), line.slice(i + 1).trim()] }))
  return {host: fields.hostname, port: Number(fields.port), username: fields.user,
    configDigest: createHash('sha256').update(JSON.stringify([stdout, sshArgs(server)])).digest('hex')}
}

export async function remoteCall(server, request) {
  const connection = await probeTarget(server)
  if (JSON.stringify(connection) !== JSON.stringify(request.spec.connection)) throw new Error('Execution target changed; authorization no longer matches')
  const local = isLocalTarget(server)
  if (local && (request.spec.network || request.spec.gpu_devices?.length || request.spec.sandbox?.network || request.spec.sandbox?.gpu_devices?.length)) throw new Error('本机验收仅支持离线 CPU 实验')
  // Send data over stdin, never interpolate user commands into the SSH invocation.
  return new Promise((resolve, reject) => {
    const child = local
      ? spawn('docker', [...dockerArgs(), 'exec', '-i', connection.containerId, 'python3', '-c', runner], {windowsHide:true})
      : spawn('ssh', [...sshArgs(server), 'python3 -c ' + quote(runner)], {windowsHide: true})
    let output = '', error = '', size = 0, done = false
    const finish = (err, value) => { if (done) return; done = true; clearTimeout(timer); err ? reject(err) : resolve(value) }
    const timer = setTimeout(() => { child.kill(); finish(new Error('Execution observation timed out; state unknown')) }, 15000)
    child.on('error', err => finish(err))
    child.stdin.on('error', () => {})
    child.stdout.on('data', data => {
      size += data.length
      if (size > 2 * 1024 * 1024) { child.kill(); finish(new Error('Execution response exceeds bounded read')) }
      else output += data.toString('utf8')
    })
    child.stderr.on('data', data => { error = (error + data).slice(-2000) })
    child.on('close', code => {
      if (local && code !== 0) return finish(new Error('本机 Docker 执行器不可用；任务状态未知'))
      if (code !== 0) return finish(new Error(/Permission denied|Authentication failed/i.test(error) ? 'SSH 认证失败' : /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(error) ? 'SSH 主机身份校验失败' : 'SSH unavailable'))
      try { const value = JSON.parse(output); if (value.error) throw new Error(value.error); finish(null, value) } catch (err) { finish(err) }
    })
    child.stdin.end(JSON.stringify({...request, ...(request.action === 'submit' ? {runner} : {})}))
  })
}

async function update(deps, job, action) {
  let next
  try {
    const result = await remoteCall(job.spec.server, {action, id: job.id, spec: job.spec})
    next = {...job, ...result, observedAt: new Date().toISOString(), observationError: null}
  } catch (error) {
    // remoteCall sanitizes SSH diagnostics; protocol errors describe authorized paths.
    next = {...job, status: 'unknown', exitCode: null, observationError: String(error.message).slice(0, 500) + '；远端状态未知，请重连观察或沿用同一身份重试'}
  }
  await deps.domain.table('jobs').put(job.id, next)
  return next
}
export const durableSubmit = (deps, job) => update(deps, job, 'submit')
export const durableObserve = (deps, job) => update(deps, job, 'observe')
