"""Capture only synthetic PTY data, with no user rc, history, or theme hooks."""
import base64, fcntl, json, os, pathlib, pty, select, signal, struct, tempfile, termios, time

out = pathlib.Path(__file__).parent
plugin_root = pathlib.Path('/home/ricii/.oh-my-zsh/custom/plugins')
plugins = [plugin_root / 'zsh-autosuggestions/zsh-autosuggestions.zsh',
           plugin_root / 'zsh-syntax-highlighting/zsh-syntax-highlighting.zsh']
assert all(p.is_file() for p in plugins), 'Installed plugins required for this local repro'

def drain(fd, seconds=0.35):
    data = b''
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if select.select([fd], [], [], 0.03)[0]:
            data += os.read(fd, 65536)
    return data

with tempfile.TemporaryDirectory(prefix='terminal-colors-zsh-') as home:
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(home)
        os.execve('/usr/bin/zsh', ['zsh', '-d', '-f', '-i'], {
            'HOME': home, 'ZDOTDIR': home, 'PATH': '/usr/bin:/bin',
            'TERM': 'xterm-256color', 'LANG': 'C.UTF-8', 'HISTFILE': '/dev/null',
            'PROMPT': 'fixture> ', 'PS2': 'fixture-more> '
        })
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
        drain(fd)
        setup = ('HISTFILE=/dev/null; SAVEHIST=0; HISTSIZE=20; unsetopt BEEP; bindkey -e; '
                 + '; '.join('source ' + str(p) for p in plugins)
                 + "; PROMPT='%F{green}❯%f '; print -s 'echo suggestion-demo'; "
                 + "printf '\\e[2J\\e[H\\e[36mIsolated zsh + installed plugins\\e[0m\\r\\n"
                   "ANSI8: \\e[38;5;8mghost gray\\e[0m | ANSI240: \\e[38;5;240mshell gray\\e[0m\\r\\n"
                   "Dim: \\e[2mdim text\\e[0m | \\e[31mred \\e[32mgreen \\e[34mblue\\e[0m\\r\\n"
                   "Glyphs: Agjpqy _ | ❯ → ✓ café 日本語\\r\\n'\n")
        os.write(fd, setup.encode())
        initial = drain(fd, 0.7)
        # Clear-screen is emitted by the synthetic printf, not rewritten shell output.
        initial = initial[initial.index(b'\x1b[2J'):]
        os.write(fd, b'echo')
        typing = drain(fd, 0.7)
        assert b'suggestion-demo' in typing and b'\x1b[90m' in typing, repr(typing)
        os.write(fd, b'\r')
        enter = drain(fd, 0.6)
        # Enter executes just "echo": the proposed argument must not appear in output.
        assert b'suggestion-demo' not in enter, repr(enter)
        os.write(fd, b'echo')
        again = drain(fd, 0.5)
        os.write(fd, b'\x03')
        cancel = drain(fd, 0.4)
        os.write(fd, b"ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=240'; print -s 'echo suggestion-demo'\r")
        drain(fd, 0.5)
        os.write(fd, b'echo')
        explicit = drain(fd, 0.6)
        assert b'\x1b[38;5;240m' in explicit, repr(explicit)
        captures = {k: base64.b64encode(v).decode() for k, v in {
            'initial': initial, 'typing': typing, 'enter': enter,
            'again': again, 'cancel': cancel, 'explicit240': explicit}.items()}
        (out / 'zsh-capture.json').write_text(json.dumps(captures, indent=2) + '\n')
        (out / 'zsh-checks.json').write_text(json.dumps({
            'shell': 'zsh -d -f -i; empty HOME/ZDOTDIR; minimal environment',
            'plugins': [str(p.relative_to(plugin_root)) for p in plugins],
            'history': 'synthetic echo suggestion-demo only; no user history read',
            'defaultSuggestionANSI8': True, 'explicitSuggestionANSI240': True,
            'enterDoesNotAcceptSuggestion': True, 'ctrlCThenInput': True
        }, indent=2) + '\n')
        print('PASS: real zsh plugins emit ANSI8 / explicit ANSI240; Enter does not accept ghost text')
    finally:
        # Only this disposable fixture shell, never an existing user terminal.
        os.kill(pid, signal.SIGHUP)
        os.close(fd)
        os.waitpid(pid, 0)
