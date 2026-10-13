"""Supabase Auth adapter. Credentials stay in HTTP-only cookies, never app JSON."""
from __future__ import annotations

import json
import os
import re
from ipaddress import ip_address
from http.cookies import SimpleCookie, CookieError
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler


class AuthError(Exception):
    def __init__(self, message, status=401):
        super().__init__(message)
        self.status = status


def email_address(value):
    if not isinstance(value, str) or len(value) > 254 or not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", value.strip()):
        raise AuthError('请输入有效的邮箱地址', 400)
    return value.strip().lower()


def client_address(peer, forwarded=None, trust_proxy=False):
    address = ip_address(peer)
    if trust_proxy and address.is_loopback and forwarded:
        try:
            address = ip_address(forwarded)
        except ValueError:
            raise AuthError('代理客户端地址无效', 400) from None
    return str(address)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Auth:
    def __init__(self, url=None, public_url=None):
        self.url = (os.getenv('METHODATLAS_AUTH_URL', '') if url is None else url).rstrip('/')
        self.public_url = (os.getenv('METHODATLAS_PUBLIC_URL', '') if public_url is None else public_url).rstrip('/')
        self.enabled = bool(self.url)
        self.api_key = os.getenv('METHODATLAS_AUTH_ANON_KEY', '')
        for address in (self.url, self.public_url):
            if address:
                parsed = urlsplit(address)
                if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
                    raise ValueError('认证/站点地址无效')
                if parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
                    raise ValueError('非本机认证/站点地址必须使用 HTTPS')
        if self.public_url and not self.enabled:
            raise ValueError('在线站点必须配置 Supabase Auth，不能以本地免登录模式启动')
        self.secure = self.public_url.startswith('https://')
        self.client = build_opener(NoRedirect)

    def request(self, path, body=None, token=None, method=None, client_ip=None):
        if not self.enabled:
            raise AuthError('账号服务尚未配置', 503)
        headers = {'Content-Type': 'application/json', 'X-MethodAtlas-Client-IP': client_address(client_ip or '127.0.0.1')}
        if self.api_key:
            headers['apikey'] = self.api_key
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = Request(self.url + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        try:
            with self.client.open(request, timeout=10) as response:
                raw = response.read(1_000_001)
                if len(raw) > 1_000_000:
                    raise AuthError('账号服务返回异常，请稍后重试', 502)
                return json.loads(raw) if raw else {}
        except HTTPError as exc:
            # Never forward provider response bodies, URLs, tokens or SMTP errors.
            if exc.code == 429:
                raise AuthError('请求过于频繁，请稍后重试', 429) from None
            if exc.code >= 500:
                raise AuthError('账号服务暂时不可用，请稍后重试', 503) from None
            raise AuthError('登录信息无效或已过期，请重新验证邮箱') from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise AuthError('账号服务暂时不可用，请稍后重试', 503) from None

    def otp(self, body, client_ip=None):
        email = email_address(body.get('email'))
        self.request('/otp', {'email': email, 'create_user': True}, client_ip=client_ip)
        return {'sent': True, 'message': '请查看邮箱中的验证码'}

    def verify(self, body, client_ip=None):
        email = email_address(body.get('email'))
        code = body.get('code')
        if not isinstance(code, str) or not re.fullmatch(r'\d{6,10}', code):
            raise AuthError('请输入邮件中的数字验证码', 400)
        return self.request('/verify', {'email': email, 'token': code, 'type': 'email'}, client_ip=client_ip)

    def user(self, access, client_ip=None):
        if not access:
            raise AuthError('请先登录')
        user = self.request('/user', token=access, client_ip=client_ip)
        if not isinstance(user, dict) or not isinstance(user.get('id'), str) or not re.fullmatch(r'[0-9a-fA-F-]{36}', user['id']) or not user.get('email_confirmed_at'):
            raise AuthError('请先完成邮箱验证')
        return {'id': user['id'], 'email': email_address(user.get('email'))}

    def cookies(self, session=None):
        cookies = []
        for key, field, age in (('ma_access', 'access_token', min(int((session or {}).get('expires_in', 3600)), 86400)), ('ma_refresh', 'refresh_token', 30 * 86400)):
            value = (session or {}).get(field, '')
            if not isinstance(value, str) or len(value) > 16000 or any(c in value for c in '\r\n'):
                raise AuthError('账号服务返回异常', 502)
            cookie = SimpleCookie()
            cookie[key] = value
            cookie[key]['path'] = '/'
            cookie[key]['httponly'] = True
            cookie[key]['samesite'] = 'Lax'
            cookie[key]['max-age'] = age if value else 0
            if self.secure:
                cookie[key]['secure'] = True
            cookies.append(cookie[key].OutputString())
        return cookies

    @staticmethod
    def read_cookies(header):
        if len(header or '') > 40000:
            raise AuthError('登录信息无效，请重新登录')
        cookie = SimpleCookie()
        try:
            cookie.load(header or '')
        except CookieError:
            raise AuthError('登录信息无效，请重新登录') from None
        return {key: cookie[key].value for key in ('ma_access', 'ma_refresh') if key in cookie}

    def authenticate(self, header, client_ip=None):
        cookies = self.read_cookies(header)
        try:
            return self.user(cookies.get('ma_access'), client_ip), []
        except AuthError as exc:
            if exc.status != 401 or not cookies.get('ma_refresh'):
                raise
        session = self.request('/token?grant_type=refresh_token', {'refresh_token': cookies['ma_refresh']}, client_ip=client_ip)
        return self.user(session.get('access_token'), client_ip), self.cookies(session)

    def logout(self, header, client_ip=None):
        token = self.read_cookies(header).get('ma_access')
        if token:
            try:
                self.request('/logout', token=token, method='POST', client_ip=client_ip)
            except AuthError as exc:
                if exc.status != 401:
                    raise
        return self.cookies()
