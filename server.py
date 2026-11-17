import json
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
IMAGE_DIR = ROOT / "img"
QUESTIONS_FILE = ROOT / "questions.json"
MAX_IMAGE_SIZE = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


class QuizHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "Invalid Content-Length."})
            return None
        if length <= 0 or length > 2 * 1024 * 1024:
            self._send_json(413, {"error": "Question data must be under 2 MB."})
            return None
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(400, {"error": "Request body must be valid JSON."})
            return None

    def do_GET(self):
        if urlparse(self.path).path == "/api/questions":
            try:
                questions = json.loads(QUESTIONS_FILE.read_text(encoding="utf-8"))
            except FileNotFoundError:
                questions = []
            except (OSError, json.JSONDecodeError) as error:
                self._send_json(500, {"error": f"Could not read questions.json: {error}"})
                return
            if not isinstance(questions, list):
                self._send_json(500, {"error": "questions.json must contain a JSON array."})
                return
            self._send_json(200, {"questions": questions})
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/images":
            self._send_json(404, {"error": "Unknown API endpoint."})
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        extension = ALLOWED_IMAGE_TYPES.get(content_type)
        if extension is None:
            self._send_json(415, {"error": "Only JPEG, PNG, and WebP images are supported."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "Invalid Content-Length."})
            return
        if length <= 0 or length > MAX_IMAGE_SIZE:
            self._send_json(413, {"error": "Image must be under 10 MB."})
            return
        image_data = self.rfile.read(length)
        if len(image_data) != length:
            self._send_json(400, {"error": "Incomplete image upload."})
            return
        IMAGE_DIR.mkdir(exist_ok=True)
        filename = f"{uuid.uuid4().hex}{extension}"
        try:
            (IMAGE_DIR / filename).write_bytes(image_data)
        except OSError as error:
            self._send_json(500, {"error": f"Could not save uploaded image: {error}"})
            return
        self._send_json(201, {"path": f"/img/{filename}"})

    def do_PUT(self):
        if urlparse(self.path).path != "/api/questions":
            self._send_json(404, {"error": "Unknown API endpoint."})
            return
        questions = self._read_json()
        if questions is None:
            return
        if not isinstance(questions, list) or any(not isinstance(item, dict) for item in questions):
            self._send_json(400, {"error": "Questions must be a JSON array of objects."})
            return
        temporary_file = QUESTIONS_FILE.with_suffix(".json.tmp")
        try:
            temporary_file.write_text(
                json.dumps(questions, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            temporary_file.replace(QUESTIONS_FILE)
        except OSError as error:
            self._send_json(500, {"error": f"Could not save questions.json: {error}"})
            return
        self._send_json(200, {"saved": len(questions)})


def main():
    IMAGE_DIR.mkdir(exist_ok=True)
    if not QUESTIONS_FILE.exists():
        QUESTIONS_FILE.write_text("[]\n", encoding="utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", 8000), QuizHandler)
    print("動漫宅會考已啟動：http://127.0.0.1:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n正在關閉動漫宅會考...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
