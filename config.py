import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

# Flask secret key (đổi lại cho production)
SECRET_KEY = "super-secret-key-change-me"

# Thư mục lưu file upload
UPLOAD_FOLDER = BASE_DIR / "static" / "uploads"
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)

# Database SQLite
DB_PATH = BASE_DIR / "recycle.db"
SQLALCHEMY_DATABASE_URI = f"sqlite:///{DB_PATH}"
SQLALCHEMY_TRACK_MODIFICATIONS = False

# OpenAI API key (cũng đọc từ biến môi trường)
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
