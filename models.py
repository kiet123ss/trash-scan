import json
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class Detection(db.Model):
    __tablename__ = "detections"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    file_path = db.Column(db.String(255))
    type = db.Column(db.String(50))
    result_json = db.Column(db.Text)
    created_at = db.Column(db.String(50))
    lat = db.Column(db.Float, nullable=True)
    lng = db.Column(db.Float, nullable=True)

    def __init__(self, file_path, dtype, results, lat=None, lng=None):
        self.file_path = file_path
        self.type = dtype
        self.result_json = json.dumps(results, ensure_ascii=False)
        self.created_at = datetime.now().isoformat()
        self.lat = lat
        self.lng = lng

    def to_dict(self, include_results: bool = False):
        data = {
            "id": self.id,
            "file_path": self.file_path,
            "type": self.type,
            "created_at": self.created_at,
            "lat": self.lat,
            "lng": self.lng,
        }
        if include_results:
            data["results"] = json.loads(self.result_json) if self.result_json else []
        return data
