# Standard-library PTY bridge; stdin/stdout carry newline-delimited JSON only.
import os, sys, pty, select, json, base64, struct, fcntl, termios, signal

def emit(value):
    print(json.dumps(value), flush=True)

pid, fd = pty.fork()
if pid == 0:
    os.chdir(sys.argv[1])
    os.environ['TERM'] = 'xterm-256color'
    os.execv(sys.argv[2], [sys.argv[2], '-i'])

def close(*_):
    try: os.killpg(pid, signal.SIGHUP)
    except ProcessLookupError: pass
signal.signal(signal.SIGTERM, close)
pending = b''
try:
    while True:
        ready, _, _ = select.select([fd, sys.stdin.buffer], [], [])
        if fd in ready:
            try: data = os.read(fd, 16384)
            except OSError: break
            if not data: break
            emit({'data': base64.b64encode(data).decode()})
        if sys.stdin.buffer in ready:
            data = os.read(sys.stdin.fileno(), 65536)
            if not data: break
            pending += data
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                request = json.loads(line)
                if request.get('close'): close(); continue
                if 'data' in request: os.write(fd, base64.b64decode(request['data']))
                if 'cols' in request:
                    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', request['rows'], request['cols'], 0, 0))
finally:
    close()
    os.close(fd)
    _, status = os.waitpid(pid, 0)
    emit({'exitCode': os.waitstatus_to_exitcode(status)})
