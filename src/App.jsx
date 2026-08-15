import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from '@tauri-apps/api/app'; 
import { io } from "socket.io-client";
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import "./App.css";

const socket = io("https://remote-desktop-signal.onrender.com");  

const pcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

function App() {
  const [myId, setMyId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [copied, setCopied] = useState(false);
  const [statusText, setStatusText] = useState("Подключение к серверу..."); 
  
  const [isBlocked, setIsBlocked] = useState(false);
  const isBlockedRef = useRef(false);  

  const [isMouseActive, setIsMouseActive] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isConnected, setIsConnected] = useState(false); 
  const [isHost, setIsHost] = useState(false); 
  
  const [showFps, setShowFps] = useState(false);
  const [currentFps, setCurrentFps] = useState(0);
  const [latency, setLatency] = useState(0); 

  const [appVersion, setAppVersion] = useState("..."); 

  const videoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const pcRef = useRef(null);  
  const dcRef = useRef(null);  
  const iceCandidateQueue = useRef([]);
  const activePartnerId = useRef(null); 

  const cleanupConnection = () => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (dcRef.current) { dcRef.current.close(); dcRef.current = null; }
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsConnected(false);
    setIsMouseActive(false);
    setIsHost(false); 
    activePartnerId.current = null;
    if (document.pointerLockElement) document.exitPointerLock();
    setStatusText("🌐 Сеанс завершен. Готов к новой работе!");
    setCurrentFps(0);
    setLatency(0); 
  };

  useEffect(() => {
    getVersion().then(v => setAppVersion(v)).catch(() => {});
  }, []);

  useEffect(() => {
    socket.on("connect", () => setStatusText("🌐 Подключено к серверу. Готов к работе!"));
    socket.on("disconnect", () => setStatusText("🔴 Нет связи с сервером"));
    return () => { socket.off("connect"); socket.off("disconnect"); };
  }, []);

  useEffect(() => {
    async function checkAppUpdates() {
      try {
        if (window.__TAURI_INTERNALS__) {
          const update = await check();
          if (update) {
            await update.downloadAndInstall();
            await relaunch();
          }
        }
      } catch (error) {}
    }
    checkAppUpdates();
  }, []);

  useEffect(() => {
    if (!showFps) return;
    let lastFrames = 0;
    
    const interval = setInterval(async () => {
      if (videoRef.current && videoRef.current.getVideoPlaybackQuality) {
        const quality = videoRef.current.getVideoPlaybackQuality();
        const frames = quality.totalVideoFrames;
        setCurrentFps(frames - lastFrames);
        lastFrames = frames;
      }

      if (pcRef.current) {
        try {
          const stats = await pcRef.current.getStats();
          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              if (report.currentRoundTripTime !== undefined) {
                setLatency(Math.round(report.currentRoundTripTime * 1000));
              }
            }
          });
        } catch (err) {}
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [showFps]);

  useEffect(() => {
    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === videoRef.current;
      setIsMouseActive(locked);
      if (locked) {
        setStatusText("🎮 Режим управления мышью активен (Нажмите Esc для выхода)");
      } else if (isConnected) {
        setStatusText(isHost ? "🟢 Экран транслируется. Управление передано партнеру." : "🟢 Подключено (Кликните по видео для управления мышью)");
      }
    };
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    return () => document.removeEventListener("pointerlockchange", handlePointerLockChange);
  }, [isConnected, isHost]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key.toLowerCase() === "m") {
        isBlockedRef.current = !isBlockedRef.current;
        setIsBlocked(isBlockedRef.current);
      }
      if (dcRef.current && dcRef.current.readyState === "open") {
        if (["ArrowUp", "ArrowDown", " ", "Tab", "Enter", "Meta"].includes(e.key)) e.preventDefault();
        dcRef.current.send(JSON.stringify({ type: "keypress", key: e.key }));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const idString = Math.floor(100000000 + Math.random() * 900000000).toString();
    setMyId(idString);
    
    const onConnectRegister = () => socket.emit("register", idString);
    if (socket.connected) onConnectRegister();
    socket.on("connect", onConnectRegister);

    const handleSignal = async (data) => {
      const { senderId, signalData } = data;

      if (signalData.type === "request_connection") {
        try {
          activePartnerId.current = senderId;
          setIsHost(true); 
          setStatusText("Запрос... Жду подтверждения захвата экрана");
          
          const stream = await navigator.mediaDevices.getDisplayMedia({ 
            video: { 
              frameRate: { ideal: 60, max: 120 },
              width: { ideal: 1920, max: 3840 },
              height: { ideal: 1080, max: 2160 }
            }, 
            audio: false 
          });

          stream.getVideoTracks().forEach(track => {
            if ("contentHint" in track) {
              track.contentHint = "motion";
            }
          });
          
          if (videoRef.current) videoRef.current.srcObject = stream;

          const pc = new RTCPeerConnection(pcConfig);
          pcRef.current = pc;
          
          const dc = pc.createDataChannel("inputControl");
          dc.onopen = () => { 
            setIsConnected(true); 
            setStatusText("🟢 Экран транслируется. Управление передано партнеру."); 
          };
          dc.onclose = () => cleanupConnection();
          
          dc.onmessage = async (event) => {
            if (isBlockedRef.current) return;
            const cmd = JSON.parse(event.data);
            if (cmd.type === "mousemove_relative") await invoke("move_mouse_relative", { x: cmd.x, y: cmd.y });
            else if (cmd.type === "mousedown") await invoke("mouse_down", { button: cmd.button });
            else if (cmd.type === "mouseup") await invoke("mouse_up", { button: cmd.button });
            else if (cmd.type === "wheel") await invoke("mouse_scroll", { y: cmd.delta });
            else if (cmd.type === "keypress") await invoke("key_press", { key: cmd.key });
          };

          pc.onicecandidate = (e) => {
            if (e.candidate) socket.emit("signal", { targetId: senderId, senderId: idString, signalData: { type: "ice", candidate: e.candidate } });
          };
          
          stream.getTracks().forEach(track => {
            const sender = pc.addTrack(track, stream);
            if (track.kind === "video" && sender.getParameters) {
              const params = sender.getParameters();
              if (!params.encodings) params.encodings = [{}];
              params.encodings[0].maxFramerate = 60;
              params.encodings[0].maxBitrate = 15000000;
              sender.setParameters(params).catch(() => {});
            }
          });

          stream.getVideoTracks()[0].onended = () => handleDisconnect();

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("signal", { targetId: senderId, senderId: idString, signalData: { type: "offer", offer } });
          
          setStatusText("🟡 Трансляция экрана запущена. Ожидаем соединение...");

        } catch (err) { setStatusText("❌ " + err.message); }
      } 
      else if (signalData.type === "offer") {
        activePartnerId.current = senderId;
        setIsHost(false); 
        
        const pc = new RTCPeerConnection(pcConfig);
        pcRef.current = pc;
        
        pc.ondatachannel = (event) => { 
          dcRef.current = event.channel; 
          setIsConnected(true);
          setStatusText("🟢 Подключено (Кликните по видео для управления мышью)"); 
          dcRef.current.onclose = () => cleanupConnection();
        };
        
        pc.onicecandidate = (e) => {
          if (e.candidate) socket.emit("signal", { targetId: senderId, senderId: idString, signalData: { type: "ice", candidate: e.candidate } });
        };
        
        pc.ontrack = (event) => { if (videoRef.current) videoRef.current.srcObject = event.streams[0]; };
        
        await pc.setRemoteDescription(signalData.offer);
        while (iceCandidateQueue.current.length > 0) await pc.addIceCandidate(iceCandidateQueue.current.shift());
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", { targetId: senderId, senderId: idString, signalData: { type: "answer", answer } });
      } 
      else if (signalData.type === "answer") {
        if (pcRef.current && pcRef.current.signalingState !== "stable") {
          try {
            await pcRef.current.setRemoteDescription(signalData.answer);
            while (iceCandidateQueue.current.length > 0) await pcRef.current.addIceCandidate(iceCandidateQueue.current.shift());
          } catch (err) {}
        }
      } 
      else if (signalData.type === "ice") {
        if (signalData.candidate) {
          if (pcRef.current && pcRef.current.remoteDescription) {
            try { await pcRef.current.addIceCandidate(signalData.candidate); } catch (err) {}
          } else {
            iceCandidateQueue.current.push(signalData.candidate);
          }
        }
      }
      else if (signalData.type === "peer_disconnected") {
        cleanupConnection();
      }
    };

    socket.on("signal", handleSignal);
    return () => { socket.off("connect", onConnectRegister); socket.off("signal", handleSignal); };
  }, []);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(myId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConnect = async () => {
    if (partnerId.length < 9) return;
    activePartnerId.current = partnerId;
    setStatusText("⏳ Подключение к партнеру...");
    socket.emit("signal", { senderId: myId, targetId: partnerId, signalData: { type: "request_connection" } });
    await invoke("start_connection", { partnerId });
  };

  const handleDisconnect = () => {
    if (activePartnerId.current) {
      socket.emit("signal", { senderId: myId, targetId: activePartnerId.current, signalData: { type: "peer_disconnected" } });
    }
    cleanupConnection();
  };

  const handleMouseMove = (e) => {
    if (!isMouseActive || !dcRef.current || dcRef.current.readyState !== "open") return;
    dcRef.current.send(JSON.stringify({ type: "mousemove_relative", x: e.movementX, y: e.movementY }));
  };
  const handleMouseDown = (e) => {
    if (!isMouseActive || !dcRef.current || dcRef.current.readyState !== "open") return;
    dcRef.current.send(JSON.stringify({ type: "mousedown", button: e.button === 2 ? "right" : "left" }));
  };
  const handleMouseUp = (e) => {
    if (!isMouseActive || !dcRef.current || dcRef.current.readyState !== "open") return;
    dcRef.current.send(JSON.stringify({ type: "mouseup", button: e.button === 2 ? "right" : "left" }));
  };
  const handleWheel = (e) => {
    if (!isMouseActive || !dcRef.current || dcRef.current.readyState !== "open") return;
    dcRef.current.send(JSON.stringify({ type: "wheel", delta: Math.sign(e.deltaY) }));
  };

  const handleVideoClick = () => {
    if (videoRef.current && !isHost) {
      videoRef.current.requestPointerLock();
    }
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      if (videoContainerRef.current) videoContainerRef.current.requestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  };

  const toggleTheaterMode = () => {
    setIsTheaterMode(!isTheaterMode);
  };

  return (
    <div className="container">
      <h1 className="title">Remote PC</h1>
      
      <div className="status-bar" style={{ marginBottom: "10px", color: statusText.includes("🔴") || statusText.includes("❌") ? "#ff4444" : (statusText.includes("🟡") || statusText.includes("⏳") ? "#fbbf24" : "#00ffcc"), fontSize: "14px" }}>
        {statusText}
      </div>

      {isBlocked && (
        <div className="block-warning">⚠️ УПРАВЛЕНИЕ ЗАБЛОКИРОВАНО (M - снять)</div>
      )}
      
      <div className="video-wrapper">
        <div className={`glass-panel video-panel ${isTheaterMode ? "theater" : ""}`} ref={videoContainerRef}>
          
          {showFps && (
            <div className="fps-overlay">
              FPS: {currentFps} {isConnected && `| ${latency} мс`}
            </div>
          )}

          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className="screen-player"
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            onClick={handleVideoClick}
            onContextMenu={(e) => e.preventDefault()} 
            onLoadedMetadata={(e) => e.target.play()}
            style={{ cursor: isHost ? "default" : "crosshair" }} 
          />
        </div>

        <div className="video-controls-side">
          <button 
            className={`control-btn ${showFps ? "active" : ""}`} 
            onClick={() => setShowFps(!showFps)} 
            title="Показать FPS и Пинг"
          >
            ⚡
          </button>
          <button className="control-btn" onClick={toggleTheaterMode} title={isTheaterMode ? "Вернуть размер" : "Широкий экран"}>
            {isTheaterMode ? "🗗" : "🗖"}
          </button>
          <button className="control-btn" onClick={toggleFullScreen} title="На весь экран">
            ⛶
          </button>
        </div>
      </div>

      <div className="glass-panel">
        <h2>Ваше рабочее место</h2>
        <div className="id-container" onClick={copyToClipboard} title="Нажмите, чтобы скопировать">
          <div className="id-box">{myId}</div>
          {copied && <div className="copy-tooltip">✅ Скопировано!</div>}
        </div>
      </div>
      
      <div className="glass-panel">
        <h2>Подключиться к партнеру</h2>
        <input type="text" placeholder="Введите ID" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="id-input" maxLength={9}/>
        <br />
        <button onClick={handleConnect} className="connect-btn">Подключиться</button>
        {isConnected && (
          <button onClick={handleDisconnect} className="disconnect-btn">Отключиться</button>
        )}
      </div>

      <div className="app-version">v{appVersion}</div>

    </div>
  );
}

export default App;