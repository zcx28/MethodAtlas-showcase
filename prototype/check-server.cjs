const {spawnSync} = require('node:child_process');
const stopped = new WeakSet();

// Windows venv launchers spawn the actual server as a child process.
module.exports = function stopServer(server) {
  if (!server?.pid || stopped.has(server) || server.exitCode !== null) return;
  stopped.add(server);
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  else server.kill('SIGINT');
};

module.exports.ready = server => new Promise((resolve,reject) => {
  let log = '';
  const timer = setTimeout(()=>reject(Error('Test server startup timed out: '+log)),30000);
  server.stdout.on('data',chunk=>{
    log += chunk;
    const match = log.match(/MethodAtlas: (http:\/\/127\.0\.0\.1:\d+)/);
    if(match){clearTimeout(timer);resolve(match[1]);}
  });
  server.stderr.on('data',chunk=>{log+=chunk;});
  server.once('error',error=>{clearTimeout(timer);reject(error);});
  server.once('exit',code=>{clearTimeout(timer);reject(Error(`Test server exited ${code}: ${log}`));});
});
