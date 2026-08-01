"""Servidor de desenvolvimento com cache desligado.

O http.server padrão manda Last-Modified e o navegador responde com 304,
servindo o módulo ANTIGO do cache. Em ES modules isso é especialmente cruel:
metade do grafo vem novo e metade vem velho, e o erro que aparece não tem
relação com o que você mudou. Aqui todo recurso vai com no-store.

Uso:  python .claude/devserver.py [porta]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        # descarta o validador que dispara o 304
        if keyword.lower() == "last-modified":
            return
        super().send_header(keyword, value)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
    ThreadingHTTPServer(("127.0.0.1", porta), partial(NoCache)).serve_forever()
