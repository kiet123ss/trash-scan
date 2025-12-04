let userLat = null, userLng = null;
let map, placesService;


// Tabs
window.switchTab = function (tabId) {
  document.querySelectorAll('.col-left .panel').forEach(el => el.classList.add('hidden'));
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tabId}')"]`);
  if (activeBtn) activeBtn.classList.add('active');
};

// Geolocation
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(pos => {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
  });
}

// Upload ảnh
let selectedFile = null;

const handleFileSelect = (file) => {
  if (!file) return;
  selectedFile = file;
  document.getElementById("file-name-display").textContent = file.name;
};

document.getElementById("upload-input").onchange = (e) => {
  handleFileSelect(e.target.files[0]);
};

document.getElementById("camera-input").onchange = (e) => {
  handleFileSelect(e.target.files[0]);
};
document.getElementById("upload-btn").onclick = async () => {
  try {
    if (!selectedFile) {
      alert("Chọn ảnh hoặc chụp ảnh trước đã.");
      return;
    }

    const btn = document.getElementById("upload-btn");
    btn.disabled = true;
    btn.textContent = "Đang xử lý...";

    const formData = new FormData();
    formData.append("image", selectedFile);
    if (userLat && userLng) {
      formData.append("lat", userLat);
      formData.append("lng", userLng);
    }

    const res = await fetch("/api/detect/image", { method: "POST", body: formData });
    const data = await res.json();

    btn.disabled = false;
    btn.textContent = "Nhận dạng";

    if (data.error) {
      alert(data.error);
      return;
    }

    const div = document.getElementById("upload-result");
    // Cache busting
    const imgUrl = data.image_url + "?t=" + new Date().getTime();
    div.innerHTML = "<img src='" + imgUrl + "'>" + formatDetectionResults(data.detections);

    handleRecycleSuggestion(data.detections);
  } catch (e) {
    console.error(e);
    alert("Có lỗi xảy ra: " + e.message);
    document.getElementById("upload-btn").disabled = false;
    document.getElementById("upload-btn").textContent = "Nhận dạng";
  }
};

// Camera
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
let currentStream = null;
let facingMode = "environment"; // Mặc định cam sau


async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Lỗi: Trình duyệt không hỗ trợ Camera hoặc kết nối không bảo mật (cần HTTPS hoặc localhost).");
    return;
  }

  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    if (trackingInterval) clearInterval(trackingInterval);
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facingMode }
    });
    currentStream = stream;
    video.srcObject = stream;
    document.getElementById("switch-cam").classList.remove("hidden");
    document.getElementById("save-cam").classList.remove("hidden");

    // Hiển thị canvas đè lên video
    canvas.style.display = "block";
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    // Bắt đầu loop nhận dạng
    startTracking();
  } catch (err) {
    console.error(err);
    alert("Không thể bật camera: " + err.message);
  }
}

// Tracking State
let trackingInterval = null;
let animationFrameId = null;
let activeTracks = {}; // Store track state: { id: { x, y, w, h, label, color, lastSeen } }
const LERP_FACTOR = 0.35; // Tốc độ làm mượt - nhanh hơn để theo kịp vật thể
const TRACK_TIMEOUT = 400; // Xóa track nhanh hơn để tránh box trùng

function startTracking() {
  let isProcessing = false;
  let inFlight = false; // Cờ để tránh request xếp hàng (queue)

  // 1. Start Detection Loop (Network)
  trackingInterval = setInterval(async () => {
    if (!video.videoWidth || isProcessing || inFlight) return;
    isProcessing = true;
    inFlight = true;

    // Setup canvas for downscaling
    const MAX_WIDTH = 400;
    const scale = MAX_WIDTH / video.videoWidth;
    const sendWidth = MAX_WIDTH;
    const sendHeight = video.videoHeight * scale;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = sendWidth;
    tempCanvas.height = sendHeight;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(video, 0, 0, sendWidth, sendHeight);
    const dataUrl = tempCanvas.toDataURL("image/jpeg", 0.4);

    try {
      const res = await fetch("/api/detect/frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: dataUrl })
      });
      const data = await res.json();

      if (data.detections) {
        const now = performance.now();

        // Update active tracks with new data
        data.detections.forEach(d => {
          // Scale bbox back to original video size
          const x1 = d.bbox[0] / scale;
          const y1 = d.bbox[1] / scale;
          const x2 = d.bbox[2] / scale;
          const y2 = d.bbox[3] / scale;

          const targetX = x1;
          const targetY = y1;
          const targetW = x2 - x1;
          const targetH = y2 - y1;

          const trackId = d.track_id !== null ? d.track_id : `raw_${Math.random()}`; // Fallback if no ID

          if (activeTracks[trackId]) {
            // Update target for interpolation
            activeTracks[trackId].target = { x: targetX, y: targetY, w: targetW, h: targetH };
            activeTracks[trackId].label = `${d.track_id ? "ID:" + d.track_id : ""} ${d.class_name} ${d.confidence.toFixed(2)}`;
            activeTracks[trackId].color = d.recyclable ? "#00ff00" : "#ff0000";
            activeTracks[trackId].lastSeen = now;
          } else {
            // New track
            activeTracks[trackId] = {
              current: { x: targetX, y: targetY, w: targetW, h: targetH }, // Start at target
              target: { x: targetX, y: targetY, w: targetW, h: targetH },
              label: `${d.track_id ? "ID:" + d.track_id : ""} ${d.class_name} ${d.confidence.toFixed(2)}`,
              color: d.recyclable ? "#00ff00" : "#ff0000",
              lastSeen: now
            };
          }
        });

        handleRecycleSuggestion(data.detections);
      }
    } catch (e) {
      console.error("Tracking error:", e);
    } finally {
      isProcessing = false;
      inFlight = false; // Cho phép gửi request tiếp
    }
  }, 80); // ~12.5 FPS detection - faster, more responsive tracking

  // 2. Start Render Loop (60 FPS Animation)
  function renderLoop() {
    if (!video.videoWidth) {
      animationFrameId = requestAnimationFrame(renderLoop);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const now = performance.now();

    for (const id in activeTracks) {
      const track = activeTracks[id];

      // Remove old tracks
      if (now - track.lastSeen > TRACK_TIMEOUT) {
        delete activeTracks[id];
        continue;
      }

      // Interpolate (Lerp) current -> target
      track.current.x += (track.target.x - track.current.x) * LERP_FACTOR;
      track.current.y += (track.target.y - track.current.y) * LERP_FACTOR;
      track.current.w += (track.target.w - track.current.w) * LERP_FACTOR;
      track.current.h += (track.target.h - track.current.h) * LERP_FACTOR;

      // Draw
      ctx.strokeStyle = track.color;
      ctx.lineWidth = 4;
      ctx.strokeRect(track.current.x, track.current.y, track.current.w, track.current.h);

      ctx.fillStyle = track.color;
      ctx.font = "bold 20px Arial";
      ctx.fillText(track.label, track.current.x, track.current.y - 10);
    }

    animationFrameId = requestAnimationFrame(renderLoop);
  }

  // Start the loop
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  renderLoop();
}


document.getElementById("start-cam").onclick = () => {
  startCamera();
};

document.getElementById("switch-cam").onclick = () => {
  facingMode = facingMode === "user" ? "environment" : "user";
  startCamera();
};

document.getElementById("save-cam").onclick = async () => {
  if (!video.videoWidth) {
    alert("Camera chưa sẵn sàng. Vui lòng đợi một chút.");
    return;
  }

  const btn = document.getElementById("save-cam");
  btn.disabled = true;
  btn.textContent = "Đang lưu...";

  try {
    // Capture current frame from video
    const captureCanvas = document.createElement("canvas");
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    const ctx = captureCanvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.9);

    // Send to backend
    const payload = {
      image_base64: dataUrl
    };
    if (userLat && userLng) {
      payload.lat = userLat;
      payload.lng = userLng;
    }

    const res = await fetch("/api/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.error) {
      alert(data.error);
    } else {
      // Display result in cam-result div
      const div = document.getElementById("cam-result");
      const imgUrl = data.image_url + "?t=" + new Date().getTime();
      div.innerHTML = "<img src='" + imgUrl + "'>" + formatDetectionResults(data.detections);

      // Scroll to result
      div.scrollIntoView({ behavior: "smooth" });

      // Handle recycle suggestion
      handleRecycleSuggestion(data.detections);

      alert("Đã lưu ảnh vào lịch sử!");
    }
  } catch (e) {
    console.error(e);
    alert("Có lỗi xảy ra: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "📸 Lưu ảnh";
  }
};

// Lịch sử
// Lịch sử
document.getElementById("load-history").onclick = async () => {
  const res = await fetch("/api/history");
  const data = await res.json();
  const ul = document.getElementById("history-list");
  ul.innerHTML = "";
  data.forEach(item => {
    const li = document.createElement("li");
    li.textContent = "#" + item.id + " - " + item.type + " - " + item.created_at;
    li.style.cursor = "pointer";
    li.title = "Click để xem lại kết quả";

    li.onclick = async () => {
      const resDetail = await fetch(`/api/history/${item.id}`);
      const detail = await resDetail.json();
      if (detail.error) {
        alert(detail.error);
        return;
      }

      // Hiển thị lại vào khung upload-result
      const div = document.getElementById("upload-result");
      div.innerHTML = "<img src='" + detail.file_path + "'>" + formatDetectionResults(detail.results);

      // Scroll tới đó
      div.scrollIntoView({ behavior: "smooth" });

      // Gọi lại gợi ý
      handleRecycleSuggestion(detail.results);
    };

    ul.appendChild(li);
  });
};

// Chatbot
function addChatBubble(sender, text) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (sender === "Bạn" ? "user" : "bot");
  const span = document.createElement("span");
  span.textContent = text;
  wrap.appendChild(span);

  const chatWin = document.getElementById("chat-window");
  chatWin.appendChild(wrap);
  chatWin.scrollTop = chatWin.scrollHeight;
}

let chatInitialized = false;

function openChatPanel() {
  const panel = document.getElementById("chat-panel");
  panel.classList.add("open");

  // Gửi câu chào 1 lần khi mở lần đầu
  if (!chatInitialized) {
    addChatBubble("Bot", "Chào bạn,tôi là trợ lý Trash Scan và tôi sẵn sàng hỗ trợ. Bạn có thắc mắc gì không?");
    chatInitialized = true;
  }
}

function closeChatPanel() {
  const panel = document.getElementById("chat-panel");
  panel.classList.remove("open");
}

// Nút bubble mở/đóng
document.getElementById("chat-launcher").onclick = () => {
  const panel = document.getElementById("chat-panel");
  if (panel.classList.contains("open")) {
    closeChatPanel();
  } else {
    openChatPanel();
  }
};

// Nút X đóng
document.getElementById("chat-close").onclick = () => {
  closeChatPanel();
};

// Gửi tin nhắn
document.getElementById("chat-send").onclick = async () => {
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg) return;

  addChatBubble("Bạn", msg);
  input.value = "";

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg })
  });
  const data = await res.json();
  addChatBubble("Bot", data.answer);
};

// Enter để gửi
document.getElementById("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    document.getElementById("chat-send").click();
  }
});
// Google Maps & gợi ý điểm thu gom
let markersArray = []; // Store markers for clearing

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 10.77, lng: 106.69 },
    zoom: 13
  });
  placesService = new google.maps.places.PlacesService(map);
}
window.initMap = initMap;

// Manual place search
document.getElementById("search-place").onclick = () => {
  const query = document.getElementById("place-search").value.trim();
  if (!query) {
    alert("Vui lòng nhập từ khóa tìm kiếm");
    return;
  }

  if (!placesService) {
    alert("Bản đồ chưa sẵn sàng. Vui lòng thử lại.");
    return;
  }

  // Clear existing markers
  markersArray.forEach(marker => marker.setMap(null));
  markersArray = [];

  // Use current location or default
  const searchLocation = (userLat && userLng)
    ? new google.maps.LatLng(userLat, userLng)
    : new google.maps.LatLng(10.77, 106.69);

  const request = {
    location: searchLocation,
    radius: 10000, // 10km
    keyword: query
  };

  placesService.nearbySearch(request, (results, status) => {
    if (status === google.maps.places.PlacesServiceStatus.OK) {
      map.setCenter(searchLocation);

      results.forEach(place => {
        const marker = new google.maps.Marker({
          map,
          position: place.geometry.location,
          title: place.name,
          animation: google.maps.Animation.DROP
        });

        // Info window
        const infowindow = new google.maps.InfoWindow({
          content: `<strong>${place.name}</strong><br>${place.vicinity || ''}`
        });

        marker.addListener('click', () => {
          infowindow.open(map, marker);
        });

        markersArray.push(marker);
      });

      document.getElementById("recycle-info").textContent =
        `Tìm thấy ${results.length} địa điểm cho: "${query}"`;
    } else {
      alert("Không tìm thấy kết quả. Thử từ khóa khác.");
    }
  });
};

// Enter to search
document.getElementById("place-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("search-place").click();
  }
});

// Format detection results as HTML
function formatDetectionResults(detections) {
  if (!detections || detections.length === 0) {
    return '<div class="detection-empty">Không phát hiện đối tượng nào</div>';
  }

  let html = '<div class="detection-results">';
  detections.forEach((d, idx) => {
    const recyclableText = d.recyclable ? 'Có thể tái chế' : 'Không thể tái chế';
    const recyclableClass = d.recyclable ? 'recyclable-yes' : 'recyclable-no';

    html += `
      <div class="detection-card">
        <div class="detection-header">
          <span class="detection-number">#${idx + 1}</span>
          <span class="${recyclableClass}">${recyclableText}</span>
        </div>
        <div class="detection-body">
          <div class="detection-row">
            <span class="detection-label">Loại rác:</span>
            <span class="detection-value">${d.display_name || d.class_name || 'N/A'}</span>
          </div>
          <div class="detection-row">
            <span class="detection-label">Mã loại:</span>
            <span class="detection-value">${d.class_id !== undefined ? d.class_id : 'N/A'}</span>
          </div>
          <div class="detection-row">
            <span class="detection-label">Độ tin cậy:</span>
            <span class="detection-value">${(d.confidence * 100).toFixed(1)}%</span>
          </div>
          ${d.tip ? `
          <div class="detection-tip">
            <span class="tip-icon">💡</span>
            <span class="tip-text">${d.tip}</span>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  });
  html += '</div>';
  return html;
}

function handleRecycleSuggestion(detections) {
  const recyclable = detections.find(d => d.recyclable && d.gmaps_keyword);
  const infoEl = document.getElementById("recycle-info");

  if (!recyclable) {
    infoEl.textContent = "Chưa phát hiện loại rác tái chế rõ ràng hoặc chưa có gợi ý điểm thu gom.";
    return;
  }

  infoEl.textContent = `Phát hiện: ${recyclable.display_name || recyclable.class_name} – ${recyclable.tip}`;

  if (!userLat || !userLng || !placesService) return;

  // Clear existing markers
  markersArray.forEach(marker => marker.setMap(null));
  markersArray = [];

  const request = {
    location: new google.maps.LatLng(userLat, userLng),
    radius: 5000,
    keyword: recyclable.gmaps_keyword
  };
  placesService.nearbySearch(request, (results, status) => {
    if (status !== google.maps.places.PlacesServiceStatus.OK) return;
    map.setCenter(request.location);

    results.forEach(place => {
      const marker = new google.maps.Marker({
        map,
        position: place.geometry.location,
        title: place.name
      });
      markersArray.push(marker);
    });
  });
}
