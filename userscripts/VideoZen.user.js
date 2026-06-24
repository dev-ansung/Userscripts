// ==UserScript==
// @name         VideoZen
// @namespace    http://tampermonkey.net/
// @version      2.7
// @description  Watch anything, your way — subtitles, gamma, zoom, and recording built in.
// @match        *://*/*
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    const mkEl = (tag, css, props = {}) => { const el = document.createElement(tag); if (css) el.style.cssText = css; return Object.assign(el, props); };

    // ==========================================
    // Subtitle Plugin
    // ==========================================
    function srtLoaderPlugin() {
        const player = this;

        const parseTime = (t) => {
            const p = t.trim().split(':'), s = p[2].split(',');
            return +p[0] * 3600 + +p[1] * 60 + +s[0] + +s[1] / 1000;
        };
        const fmtTime = (t) => [t/3600, t%3600/60, t%60].map(n => String(Math.floor(n)).padStart(2,'0')).join(':');

        // Navigator panel
        const panel     = mkEl('div', 'display:none;position:absolute;bottom:52px;left:8px;width:360px;max-height:300px;overflow:hidden;flex-direction:column;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.06);border-radius:10px;z-index:10;backdrop-filter:blur(12px);');
        const panelTitle = mkEl('span', 'font-size:10px;color:rgba(255,255,255,0.35);letter-spacing:0.05em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;');
        const panelClose = mkEl('button', 'background:none;border:none;color:rgba(255,255,255,0.3);font-size:11px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;', { textContent: '✕' });
        const panelHeader = mkEl('div', 'display:flex;align-items:center;justify-content:space-between;padding:7px 12px 6px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;');
        const panelList  = mkEl('div', 'overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.12) transparent;');
        panelClose.onmouseenter = () => panelClose.style.color = '#fff';
        panelClose.onmouseleave = () => panelClose.style.color = 'rgba(255,255,255,0.3)';
        panelClose.onclick = () => panel.style.display = 'none';
        panelHeader.append(panelTitle, panelClose);
        panel.append(panelHeader, panelList);
        player.el().appendChild(panel);

        const showPanel = () => panel.style.display = 'flex';
        const hidePanel = () => panel.style.display = 'none';

        let activeCueIndex = -1;

        const buildNavigator = (track, filename) => {
            panelTitle.textContent = filename || 'Captions';
            panelList.innerHTML = '';
            activeCueIndex = -1;

            Array.from(track.cues).forEach(cue => {
                const tsSpan  = mkEl('span', 'flex-shrink:0;font-variant-numeric:tabular-nums;font-size:10px;color:rgba(255,255,255,0.3);letter-spacing:0.03em;', { className: 'vz-ts', textContent: fmtTime(cue.startTime) });
                const txtSpan = mkEl('span', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', { textContent: new DOMParser().parseFromString(cue.text, 'text/html').body.textContent });
                const row = mkEl('div', 'display:flex;align-items:baseline;gap:10px;padding:6px 14px;color:rgba(255,255,255,0.45);font-size:11.5px;cursor:pointer;transition:background 0.1s;');
                row.onmouseenter = () => { if (!row.classList.contains('vz-active')) row.style.background = 'rgba(255,255,255,0.06)'; };
                row.onmouseleave = () => { if (!row.classList.contains('vz-active')) row.style.background = ''; };
                row.onclick = () => player.currentTime(cue.startTime);
                row.append(tsSpan, txtSpan);
                panelList.appendChild(row);
            });

            const setActive = (i) => {
                if (i === activeCueIndex) return;
                const rows = panelList.children;
                const deactivate = (idx) => {
                    const r = rows[idx], ts = r?.querySelector('.vz-ts');
                    r?.classList.remove('vz-active');
                    if (r) { r.style.color = 'rgba(255,255,255,0.45)'; r.style.fontWeight = ''; r.style.background = ''; }
                    if (ts) ts.style.color = 'rgba(255,255,255,0.3)';
                };
                const activate = (idx) => {
                    const r = rows[idx], ts = r?.querySelector('.vz-ts');
                    r?.classList.add('vz-active');
                    if (r) { r.style.color = '#fff'; r.style.fontWeight = '600'; r.style.background = 'rgba(255,255,255,0.07)'; }
                    if (ts) ts.style.color = 'rgba(255,255,255,0.6)';
                    if (panel.style.display !== 'none') r?.scrollIntoView({ block: 'nearest' });
                };
                if (activeCueIndex >= 0) deactivate(activeCueIndex);
                activeCueIndex = i;
                if (i >= 0) activate(i);
            };

            player.on('timeupdate', () => {
                const ct = player.currentTime();
                const cues = Array.from(track.cues);
                let current = cues.findIndex(c => ct >= c.startTime && ct < c.endTime);
                if (current >= 0) { setActive(current); return; }
                let last = -1;
                for (let i = 0; i < cues.length && ct >= cues[i].endTime; i++) last = i;
                setActive(last);
            });
        };

        // Subtitle offset
        let subtitleOffset = 0, originalCueTimes = [], activeTrack = null;

        const applyOffset = (delta) => {
            if (!activeTrack) return;
            subtitleOffset += delta;
            Array.from(activeTrack.cues).forEach((cue, i) => {
                cue.startTime = Math.max(0, originalCueTimes[i].start + subtitleOffset);
                cue.endTime   = Math.max(0, originalCueTimes[i].end   + subtitleOffset);
            });
            panelList.querySelectorAll('.vz-ts').forEach((s, i) => s.textContent = fmtTime(activeTrack.cues[i].startTime));
            showOffsetToast(subtitleOffset);
        };

        const showOffsetToast = (offset) => {
            let toast = player.el().querySelector('.vz-toast');
            if (!toast) {
                toast = mkEl('div', 'position:absolute;bottom:70px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:4px 12px;border-radius:6px;font-size:13px;pointer-events:none;z-index:20;transition:opacity 0.3s;', { className: 'vz-toast' });
                player.el().appendChild(toast);
            }
            toast.textContent = `Subtitle offset: ${offset >= 0 ? '+' : ''}${offset.toFixed(2)}s`;
            toast.style.opacity = '1';
            clearTimeout(toast._t);
            toast._t = setTimeout(() => toast.style.opacity = '0', 1500);
        };

        document.addEventListener('keydown', (e) => {
            if (!activeTrack || ['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
            if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); applyOffset(e.shiftKey ? -0.1 : -1); }
            else if (e.key === 'x' || e.key === 'X') { e.preventDefault(); applyOffset(e.shiftKey ? 0.1 : 1); }
        });

        let btnDisposed = false;

        const loadSubtitleFile = (file) => {
            if (!file || !/\.(srt|vtt)$/i.test(file.name)) return;
            if (activeTrack) player.removeRemoteTextTrack(activeTrack);
            const reader = new FileReader();
            reader.onload = (evt) => {
                const track = player.addRemoteTextTrack({ kind: 'captions', label: 'Local Captions', language: 'en' }, false).track;
                track.mode = 'showing';
                evt.target.result.split(/\r?\n\r?\n/).forEach(block => {
                    const lines = block.split(/\r?\n/);
                    if (lines.length >= 3 && lines[1].includes(' --> ')) {
                        const [start, end] = lines[1].split(' --> ');
                        track.addCue(new VTTCue(parseTime(start), parseTime(end), lines.slice(2).join('\n')));
                    }
                });
                activeTrack = track;
                subtitleOffset = 0;
                originalCueTimes = Array.from(track.cues).map(c => ({ start: c.startTime, end: c.endTime }));
                if (!btnDisposed) { btnDisposed = true; btn.dispose(); fileInput.remove(); }
                setTimeout(() => {
                    buildNavigator(track, file.name);
                    showPanel();
                    const menuContent = player.el().querySelector('.vjs-subs-caps-button .vjs-menu-content');
                    if (menuContent && !menuContent.querySelector('.vz-nav-item')) {
                        const item = mkEl('li', null, { className: 'vjs-menu-item vz-nav-item', textContent: 'Caption Navigator' });
                        item.onclick = (ev) => { ev.stopPropagation(); panel.style.display === 'none' ? showPanel() : hidePanel(); };
                        menuContent.appendChild(item);
                    }
                }, 100);
            };
            reader.readAsText(file);
        };

        const fileInput = mkEl('input', 'display:none;', { type: 'file', accept: '.srt,.vtt' });
        document.body.appendChild(fileInput);
        fileInput.onchange = (e) => loadSubtitleFile(e.target.files[0]);
        player.el().addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        player.el().addEventListener('drop', (e) => { e.preventDefault(); loadSubtitleFile(e.dataTransfer.files[0]); });

        const controlBar = player.getChild('controlBar');
        const btn = controlBar.addChild('button', {}, controlBar.children_.length - 2);
        btn.addClass('vjs-subs-caps-button');
        btn.el().title = 'Load Subtitles (.srt / .vtt)';
        btn.el().onclick = () => fileInput.click();
    }


    // ==========================================
    // Gamma Slider Plugin
    // ==========================================
    function gammaSliderPlugin() {
        const player = this;
        const videoEl = player.el().querySelector('video');
        if (!videoEl) return;

        const SVGNS = 'http://www.w3.org/2000/svg';
        const filterId = 'vjs-gamma-' + Math.random().toString(36).slice(2, 9);
        const svg = document.createElementNS(SVGNS, 'svg');
        svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;';
        const filter = document.createElementNS(SVGNS, 'filter');
        filter.setAttribute('id', filterId);
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        const comp = document.createElementNS(SVGNS, 'feComponentTransfer');
        const funcs = ['R', 'G', 'B'].map(ch => {
            const f = document.createElementNS(SVGNS, 'feFunc' + ch);
            ['type','amplitude','exponent','offset'].forEach((a, v) => f.setAttribute(a, ['gamma','1','1','0'][v]));
            comp.appendChild(f);
            return f;
        });
        filter.appendChild(comp);
        svg.appendChild(filter);
        document.body.appendChild(svg);

        const GAMMA_MIN = 0.2, GAMMA_MAX = 3;
        let gamma = 1;

        const applyGamma = (g) => {
            if (Math.abs(g - 1) < 0.001) { videoEl.style.filter = ''; return; }
            funcs.forEach(f => f.setAttribute('exponent', (1 / g).toFixed(4)));
            videoEl.style.filter = `url(#${filterId})`;
        };

        const Slider = videojs.getComponent('Slider');
        class GammaBar extends Slider {
            createEl() { return super.createEl('div', { className: 'vjs-volume-bar vjs-slider-bar' }, { 'aria-label': 'Gamma', 'aria-valuemin': GAMMA_MIN, 'aria-valuemax': GAMMA_MAX }); }
            getPercent() { return (gamma - GAMMA_MIN) / (GAMMA_MAX - GAMMA_MIN); }
            handleMouseMove(e) { gamma = Math.min(GAMMA_MAX, Math.max(GAMMA_MIN, GAMMA_MIN + this.calculateDistance(e) * (GAMMA_MAX - GAMMA_MIN))); applyGamma(gamma); this.update(); }
            stepForward() { gamma = Math.min(GAMMA_MAX, gamma + 0.1); applyGamma(gamma); this.update(); }
            stepBack()    { gamma = Math.max(GAMMA_MIN, gamma - 0.1); applyGamma(gamma); this.update(); }
        }
        GammaBar.prototype.options_ = { barName: 'volumeLevel', children: ['volumeLevel'] };
        if (!videojs.getComponent('GammaBar')) videojs.registerComponent('GammaBar', GammaBar);

        const pop = mkEl('div', 'position:absolute;display:none;z-index:10;transform:translateX(-50%);');
        pop.className = 'vjs-volume-control vjs-control vjs-volume-vertical';
        const gammaBar = new GammaBar(player, { vertical: true });
        pop.appendChild(gammaBar.el());
        player.el().appendChild(pop);
        player.ready(() => gammaBar.update());
        ['click','mousedown','pointerdown','touchstart'].forEach(ev => pop.addEventListener(ev, e => e.stopPropagation()));

        const controlBar = player.getChild('controlBar');
        const btn = controlBar.addChild('button', {}, controlBar.children_.length - 2);
        const btnEl = btn.el();
        btnEl.querySelector('.vjs-icon-placeholder').classList.add('vjs-icon-spinner');
        btnEl.title = 'Gamma (hover to adjust)';

        btnEl.addEventListener('mouseenter', () => {
            const pr = player.el().getBoundingClientRect(), br = btnEl.getBoundingClientRect();
            pop.style.left = (br.left - pr.left + br.width / 2) + 'px';
            pop.style.bottom = (pr.bottom - br.top) + 'px';
            pop.style.display = 'block';
        });
        btnEl.addEventListener('mouseleave', (e) => { if (!pop.contains(e.relatedTarget)) pop.style.display = 'none'; });
        pop.addEventListener('mouseleave', (e) => { if (!btnEl.contains(e.relatedTarget)) pop.style.display = 'none'; });
    }


    // ==========================================
    // Draw Plugin
    // ==========================================
    function drawPlugin() {
        const player = this;
        const videoEl = player.el().querySelector('video');
        if (!videoEl) return;

        const mkBtn = (text, bg) => mkEl('button', `padding:4px 10px;border:none;border-radius:12px;cursor:pointer;background:${bg};color:#fff;font-size:12px;`, { textContent: text });

        const openDraw = () => {
            player.pause();
            const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
            const s = Math.min(window.innerWidth / vw, window.innerHeight / vh);
            const cw = Math.round(vw * s), ch = Math.round(vh * s);

            const backdrop = mkEl('div', 'position:fixed;inset:0;z-index:1001;background:#000;');
            const canvas = mkEl('canvas', `position:fixed;left:${(window.innerWidth-cw)/2}px;top:${(window.innerHeight-ch)/2}px;width:${cw}px;height:${ch}px;z-index:1002;cursor:crosshair;touch-action:none;`);
            canvas.width = vw; canvas.height = vh;
            document.body.append(backdrop, canvas);

            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoEl, 0, 0);
            const snapshot = canvas.toDataURL();
            const toC = (e) => ({ x: (e.clientX - canvas.offsetLeft) * vw / cw, y: (e.clientY - canvas.offsetTop) * vh / ch });

            const colorPicker = mkEl('input', null, { type: 'color', value: '#ff0000', title: 'Color' });
            const sizeInput   = mkEl('input', 'width:80px;cursor:pointer;', { type: 'range', min: 1, max: 40, value: 4 });
            const eraserBtn   = mkBtn('Eraser', '#555');
            const clearBtn    = mkBtn('Clear', '#555');
            const saveBtn     = mkBtn('Save', '#e94560');
            const closeBtn    = mkBtn('✕', '#333');
            const toolbar = mkEl('div', 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:1003;display:flex;align-items:center;gap:10px;background:rgba(0,0,0,0.7);padding:8px 14px;border-radius:24px;');
            toolbar.append(colorPicker, sizeInput, eraserBtn, clearBtn, saveBtn, closeBtn);
            document.body.appendChild(toolbar);

            const close = () => [backdrop, canvas, toolbar].forEach(el => el.remove());
            let erasing = false;
            eraserBtn.onclick = () => { erasing = !erasing; eraserBtn.style.background = erasing ? '#fff' : '#555'; eraserBtn.style.color = erasing ? '#000' : '#fff'; };
            clearBtn.onclick  = () => { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0); img.src = snapshot; };
            saveBtn.onclick   = () => { const a = mkEl('a', null, { href: canvas.toDataURL('image/png'), download: `draw-${Date.now()}.png` }); a.click(); close(); };
            closeBtn.onclick  = close;

            let drawing = false;
            canvas.addEventListener('pointerdown', (e) => { drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); const {x,y} = toC(e); ctx.moveTo(x, y); });
            canvas.addEventListener('pointermove', (e) => {
                if (!drawing) return;
                const {x, y} = toC(e);
                ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
                ctx.strokeStyle = colorPicker.value;
                ctx.lineWidth = sizeInput.value * vw / cw;
                ctx.lineCap = ctx.lineJoin = 'round';
                ctx.lineTo(x, y); ctx.stroke();
            });
            canvas.addEventListener('pointerup', () => { drawing = false; });
        };

        const controlBar = player.getChild('controlBar');
        const btn = controlBar.addChild('button', {}, controlBar.children_.length - 2);
        btn.el().querySelector('.vjs-icon-placeholder').classList.add('vjs-icon-square');
        btn.el().title = 'Draw on frame';
        btn.el().onclick = openDraw;
    }


    // ==========================================
    // Screenshot & Record Plugin
    // ==========================================
    function screenshotRecordPlugin() {
        const player = this;
        const videoEl = player.el().querySelector('video');
        if (!videoEl) return;

        const HOLD_MS = 500;
        let holdTimer = null, recording = false, mediaRecorder = null, chunks = [];

        const makeOverlay = (contentEl, filename) => {
            const backdrop = mkEl('div', 'position:fixed;inset:0;z-index:1001;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;');
            contentEl.style.cssText = 'max-width:90vw;max-height:75vh;border-radius:6px;box-shadow:0 0 32px #000;';
            const dlBtn    = mkEl('button', 'padding:8px 20px;background:#e94560;color:#fff;border:none;border-radius:5px;font-size:14px;cursor:pointer;', { textContent: 'Download' });
            const closeBtn = mkEl('button', 'padding:8px 20px;background:#333;color:#fff;border:none;border-radius:5px;font-size:14px;cursor:pointer;', { textContent: 'Discard' });
            const btnRow = mkEl('div', 'display:flex;gap:12px;');
            dlBtn.onclick    = () => { const a = mkEl('a', null, { href: contentEl.src, download: filename }); a.click(); backdrop.remove(); };
            closeBtn.onclick = () => backdrop.remove();
            btnRow.append(dlBtn, closeBtn);
            backdrop.append(contentEl, btnRow);
            const onKey = (e) => { if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', onKey); } };
            document.addEventListener('keydown', onKey);
            backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
            document.body.appendChild(backdrop);
        };

        const takeScreenshot = () => {
            const canvas = mkEl('canvas');
            canvas.width = videoEl.videoWidth; canvas.height = videoEl.videoHeight;
            canvas.getContext('2d').drawImage(videoEl, 0, 0);
            const img = mkEl('img', null, { src: canvas.toDataURL('image/png') });
            makeOverlay(img, `screenshot-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.png`);
        };

        let recSeconds = 0, recInterval = null;

        const startRecording = () => {
            recording = true;
            chunks = []; recSeconds = 0;
            btnEl.textContent = '0s'; btnEl.style.color = '#e94560'; btnEl.title = 'Recording… release to stop';
            recInterval = setInterval(() => btnEl.textContent = (++recSeconds) + 's', 1000);
            const stream = videoEl.captureStream();
            const mimeType = ['video/mp4;codecs=avc1,mp4a.40.2','video/mp4;codecs=avc1','video/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
            const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
            mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: videoEl.videoWidth * videoEl.videoHeight * 30 });
            mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            mediaRecorder.onstop = () => {
                recording = false; clearInterval(recInterval);
                btnEl.innerHTML = '<span class="vjs-icon-placeholder vjs-icon-circle"></span>';
                btnEl.style.color = ''; btnEl.title = 'Screenshot / hold to record';
                const vid = mkEl('video', null, { src: URL.createObjectURL(new Blob(chunks, { type: mimeType })), controls: true, autoplay: true });
                makeOverlay(vid, `recording-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.${ext}`);
            };
            mediaRecorder.start();
        };

        const controlBar = player.getChild('controlBar');
        const btn = controlBar.addChild('button', {}, controlBar.children_.length - 2);
        const btnEl = btn.el();
        btnEl.querySelector('.vjs-icon-placeholder').classList.add('vjs-icon-circle');
        btnEl.title = 'Screenshot / hold to record';

        btnEl.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            holdTimer = setTimeout(() => { holdTimer = null; startRecording(); }, HOLD_MS);
        });
        btnEl.addEventListener('pointerup', () => {
            if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; takeScreenshot(); }
            else if (recording && mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
        });
        btnEl.addEventListener('pointerleave', () => { if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; } });
    }


    // ==========================================
    // Zoom & Pan Plugin
    // ==========================================
    function zoomPanPlugin() {
        const player = this;
        const videoEl = player.el().querySelector('video');
        if (!videoEl) return;

        const MIN_ZOOM = 1, MAX_ZOOM = 5;
        let zoom = 1, panX = 0, panY = 0, active = false, dragging = false;
        let dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

        videoEl.style.cssText += 'transform-origin:center center;will-change:transform;';

        const applyTransform = () => { videoEl.style.transform = zoom === 1 ? '' : `scale(${zoom}) translate(${panX}px,${panY}px)`; };
        const clampPan = () => {
            const m = (zoom - 1) / zoom * 1000;
            panX = Math.max(-m, Math.min(m, panX));
            panY = Math.max(-m, Math.min(m, panY));
        };
        const reset = () => { zoom = 1; panX = 0; panY = 0; applyTransform(); };

        player.el().addEventListener('wheel', (e) => {
            if (!active) return;
            e.preventDefault();
            zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom - e.deltaY * 0.001 * zoom));
            if (zoom === MIN_ZOOM) { panX = 0; panY = 0; }
            clampPan(); applyTransform();
        }, { passive: false });

        player.el().addEventListener('mousedown', (e) => {
            if (!active || e.button !== 0) return;
            dragging = true; dragStartX = e.clientX; dragStartY = e.clientY; panStartX = panX; panStartY = panY;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            panX = panStartX + (e.clientX - dragStartX) / zoom;
            panY = panStartY + (e.clientY - dragStartY) / zoom;
            clampPan(); applyTransform();
        });
        document.addEventListener('mouseup', () => { dragging = false; });
        player.el().addEventListener('dblclick', (e) => { if (!active) return; e.stopPropagation(); reset(); });

        const controlBar = player.getChild('controlBar');
        const btn = controlBar.addChild('button', {}, controlBar.children_.length - 2);
        btn.el().querySelector('.vjs-icon-placeholder').classList.add('vjs-icon-fullscreen-enter');
        btn.el().title = 'Zoom & Pan (scroll to zoom, drag to pan, dblclick to reset)';
        btn.el().style.opacity = '0.5';
        btn.el().onclick = (e) => {
            e.stopPropagation();
            active = !active;
            player.el().style.cursor = active ? 'grab' : '';
            btn.el().style.opacity = active ? '1' : '0.5';
            player.options_.userActions = { click: !active };
            if (!active) reset();
        };
    }


    // ==========================================
    // Core
    // ==========================================
    const activate = () => {
        const target = Array.from(document.querySelectorAll('video')).sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
        if (!target) return alert('No valid video found.');
        if (target.classList.contains('custom-vjs')) return;
        target.removeAttribute('style');
        target.className = 'custom-vjs';

        if (!window.videojs) {
            const link = mkEl('link', null, { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/video.js@8/dist/video-js.min.css' });
            const script = mkEl('script', null, { src: 'https://cdn.jsdelivr.net/npm/video.js@8/dist/video.min.js' });
            script.onload = () => initOverlay(target);
            document.head.append(link, script);
        } else {
            initOverlay(target);
        }
    };

    const initOverlay = (video) => {
        document.querySelectorAll('*').forEach(el => { if (parseInt(getComputedStyle(el).zIndex) > 1000) el.style.zIndex = '0'; });
        const overlay = mkEl('div', 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:1000;background:#000;overflow:hidden;');
        overlay.appendChild(video);
        document.body.removeAttribute('style');
        document.body.style.overflow = 'hidden';
        document.body.appendChild(overlay);

        video.removeAttribute('style');
        video.style.width = '100%'; video.style.height = '100%';
        video.classList.add('video-js', 'vjs-default-skin');
        video.controls = true;

        [srtLoaderPlugin, gammaSliderPlugin, zoomPanPlugin, screenshotRecordPlugin, drawPlugin].forEach(p => {
            if (!videojs.getPlugin(p.name)) videojs.registerPlugin(p.name, p);
        });

        localStorage.setItem('vjs-text-track-settings', JSON.stringify({ backgroundOpacity: '0', edgeStyle: 'uniform' }));

        videojs(video, { playbackRates: [0.5, 1, 1.5, 2], persistTextTrackSettings: true }, function () {
            this.srtLoaderPlugin();
            this.gammaSliderPlugin();
            this.zoomPanPlugin();
            this.screenshotRecordPlugin();
            this.drawPlugin();
            this.play();
        });
    };

    GM_registerMenuCommand('▶ VideoZen', activate);
})();
