from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
import cv2
import numpy as np
import base64
import json

from config import SECRET_KEY, SQLALCHEMY_DATABASE_URI, SQLALCHEMY_TRACK_MODIFICATIONS, UPLOAD_FOLDER
from models import db, Detection
from detect import RecycleDetector
from chatbot import answer_question


app = Flask(__name__)
app.config["SECRET_KEY"] = SECRET_KEY
app.config["SQLALCHEMY_DATABASE_URI"] = SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = SQLALCHEMY_TRACK_MODIFICATIONS
app.config["UPLOAD_FOLDER"] = str(UPLOAD_FOLDER)

db.init_app(app)
detector = RecycleDetector()

with app.app_context():
    db.create_all()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/detect/image", methods=["POST"])
def api_detect_image():
    file = request.files.get("image")
    lat = request.form.get("lat")
    lng = request.form.get("lng")

    if not file:
        return jsonify({"error": "No image uploaded"}), 400

    ext = secure_filename(file.filename).rsplit('.', 1)[-1]
    import uuid
    fname = f"{uuid.uuid4().hex}.{ext}"
    save_path = UPLOAD_FOLDER / fname
    file.save(save_path)

    img = cv2.imread(str(save_path))
    if img is None:
        return jsonify({"error": "Cannot read image"}), 400

    detections = detector.detect_image(img)

    # Vẽ các bounding box
    for d in detections:
        x1, y1, x2, y2 = map(int, d["bbox"])
        label = f"{d['class_name']} {d['confidence']:.2f}"
        color = (0, 255, 0) if d["recyclable"] else (0, 0, 255)
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        cv2.putText(img, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    cv2.imwrite(str(save_path), img)

    det = Detection(
        file_path=f"/static/uploads/{fname}",
        dtype="upload",
        results=detections,
        lat=float(lat) if lat else None,
        lng=float(lng) if lng else None,
    )
    db.session.add(det)
    db.session.commit()

    return jsonify({
        "image_url": det.file_path,
        "detections": detections
    })


@app.route("/api/detect/frame", methods=["POST"])
def api_detect_frame():
    data = request.get_json()
    if not data or "image_base64" not in data:
        return jsonify({"error": "No frame"}), 400

    b64 = data["image_base64"].split(",")[-1]
    img_bytes = base64.b64decode(b64)
    img_arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"error": "Cannot decode frame"}), 400

    detections = detector.track_image(img)
    return jsonify({"detections": detections})


@app.route("/api/capture", methods=["POST"])
def api_capture():
    """Capture current camera frame and save to history"""
    data = request.get_json()
    if not data or "image_base64" not in data:
        return jsonify({"error": "No frame"}), 400

    lat = data.get("lat")
    lng = data.get("lng")

    # Giải mã base64
    b64 = data["image_base64"].split(",")[-1]
    img_bytes = base64.b64decode(b64)
    img_arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"error": "Cannot decode frame"}), 400

    # Phân loại
    detections = detector.detect_image(img)

    # Vẽ bounding box
    for d in detections:
        x1, y1, x2, y2 = map(int, d["bbox"])
        label = f"{d['class_name']} {d['confidence']:.2f}"
        color = (0, 255, 0) if d["recyclable"] else (0, 0, 255)
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        cv2.putText(img, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

    # Lưu ảnh
    import uuid
    fname = f"{uuid.uuid4().hex}.jpg"
    save_path = UPLOAD_FOLDER / fname
    cv2.imwrite(str(save_path), img)

    # Lưu vào database
    det = Detection(
        file_path=f"/static/uploads/{fname}",
        dtype="camera",
        results=detections,
        lat=float(lat) if lat else None,
        lng=float(lng) if lng else None,
    )
    db.session.add(det)
    db.session.commit()

    return jsonify({
        "image_url": det.file_path,
        "detections": detections
    })


@app.route("/api/history", methods=["GET"])
def api_history():
    items = Detection.query.order_by(Detection.id.desc()).limit(50).all()
    return jsonify([item.to_dict(include_results=False) for item in items])


@app.route("/api/history/<int:det_id>", methods=["GET"])
def api_history_detail(det_id):
    item = Detection.query.get(det_id)
    if not item:
        return jsonify({"error": "Not found"}), 404
    return jsonify(item.to_dict(include_results=True))


@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json()
    user_msg = data.get("message", "")
    answer = answer_question(user_msg)
    return jsonify({"answer": answer})


if __name__ == "__main__":
    # Chạy với HTTPS (cert tự tạo) để ổn định hơn
    app.run(host="0.0.0.0", port=5000, debug=True, ssl_context=('cert.pem', 'key.pem'))
