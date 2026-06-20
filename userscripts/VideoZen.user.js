// ==UserScript==
// @name         VideoZen
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  Watch anything, your way — subtitles, gamma, zoom, and recording built in.
// @match        *://*/*
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // Native Video.js Subtitle Plugin
    // ==========================================
    function srtLoaderPlugin() {
        const player = this;

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.srt,.vtt';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        const parseTime = (t) => {
            const p = t.trim().split(':');
            const s = p[2].split(',');
            return parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseInt(s[0], 10) + parseInt(s[1], 10) / 1000;
        };

        // ---- Caption navigator panel ----
        const panel = document.createElement('div');
        panel.style.cssText = 'display:none;position:absolute;bottom:44px;left:8px;width:320px;max-height:260px;overflow-y:auto;background:rgba(20,20,20,0.95);border-radius:8px;z-index:10;';
        player.el().appendChild(panel);

        const buildNavigator = (track) => {
            panel.innerHTML = '';
            Array.from(track.cues).forEach(cue => {
                const t = cue.startTime;
                const ts = [Math.floor(t/3600), Math.floor(t%3600/60), Math.floor(t%60)]
                    .map(n => String(n).padStart(2,'0')).join(':');
                const row = document.createElement('div');
                const cueDoc = new DOMParser().parseFromString(cue.text, 'text/html');
                row.textContent = `${ts}  ${cueDoc.body.textContent}`;
                row.style.cssText = 'padding:5px 12px;color:#ccc;font-size:11px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                row.onmouseenter = () => row.style.background = 'rgba(255,255,255,0.08)';
                row.onmouseleave = () => row.style.background = '';
                row.onclick = () => player.currentTime(cue.startTime);
                panel.appendChild(row);
            });

            player.on('timeupdate', () => {
                const ct = player.currentTime();
                Array.from(panel.children).forEach((row, i) => {
                    const cue = track.cues[i];
                    const active = ct >= cue.startTime && ct < cue.endTime;
                    row.style.color = active ? '#fff' : '#ccc';
                    row.style.fontWeight = active ? 'bold' : 'normal';
                    if (active) row.scrollIntoView({ block: 'nearest' });
                });
            });
        };

        player.el().addEventListener('click', (e) => {
            if (!panel.contains(e.target)) panel.style.display = 'none';
        });

        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                const track = player.addRemoteTextTrack({
                    kind: 'captions', label: 'Local Captions', language: 'en'
                }, false).track;
                track.mode = 'showing';
                evt.target.result.split(/\r?\n\r?\n/).forEach(block => {
                    const lines = block.split(/\r?\n/);
                    if (lines.length >= 3 && lines[1].includes(' --> ')) {
                        const [start, end] = lines[1].split(' --> ');
                        track.addCue(new VTTCue(parseTime(start), parseTime(end), lines.slice(2).join('\n')));
                    }
                });
                btn.dispose();
                fileInput.remove();
                setTimeout(() => {
                    buildNavigator(track);
                    // Inject a menu item into the VJS captions menu
                    const menuContent = player.el().querySelector('.vjs-subs-caps-button .vjs-menu-content');
                    if (menuContent) {
                        const item = document.createElement('li');
                        item.className = 'vjs-menu-item';
                        item.textContent = 'Caption Navigator';
                        item.onclick = (ev) => {
                            ev.stopPropagation();
                            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                        };
                        menuContent.appendChild(item);
                    }
                }, 100);
            };
            reader.readAsText(file);
        };

        const controlBar = player.getChild('controlBar');
        const btn = controlBar.addChild('button', {}, controlBar.children_.length - 2);
        btn.addClass('vjs-subs-caps-button');
        btn.el().title = 'Load Subtitles (.srt / .vtt)';
        btn.el().onclick = () => fileInput.click();
    }


    // ==========================================
    // Native Video.js Gamma Slider Plugin
    // ==========================================
    function gammaSliderPlugin() {
        const player = this;
        const videoEl = player.el().querySelector('video');
        if (!videoEl) return;

        // SVG gamma filter: output = input ^ (1/gamma), operating in sRGB
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
            f.setAttribute('type', 'gamma');
            f.setAttribute('amplitude', '1');
            f.setAttribute('exponent', '1');
            f.setAttribute('offset', '0');
            comp.appendChild(f);
            return f;
        });
        filter.appendChild(comp);
        svg.appendChild(filter);
        document.body.appendChild(svg);

        const applyGamma = (gamma) => {
            if (Math.abs(gamma - 1) < 0.001) {
                videoEl.style.filter = '';
                return;
            }
            funcs.forEach(f => f.setAttribute('exponent', (1 / gamma).toFixed(4)));
            videoEl.style.filter = `url(#${filterId})`;
        };

        // GammaBar: VJS Slider subclass styled as a vertical volume bar
        const GAMMA_MIN = 0.2, GAMMA_MAX = 3;
        let gamma = 1;

        const Slider = videojs.getComponent('Slider');
        class GammaBar extends Slider {
            createEl() {
                return super.createEl('div',
                    { className: 'vjs-volume-bar vjs-slider-bar' },
                    { 'aria-label': 'Gamma', 'aria-valuemin': GAMMA_MIN, 'aria-valuemax': GAMMA_MAX }
                );
            }
            getPercent() {
                return (gamma - GAMMA_MIN) / (GAMMA_MAX - GAMMA_MIN);
            }
            handleMouseMove(e) {
                gamma = Math.min(GAMMA_MAX, Math.max(GAMMA_MIN,
                    GAMMA_MIN + this.calculateDistance(e) * (GAMMA_MAX - GAMMA_MIN)
                ));
                applyGamma(gamma);
                this.update();
            }
            stepForward() { gamma = Math.min(GAMMA_MAX, gamma + 0.1); applyGamma(gamma); this.update(); }
            stepBack()    { gamma = Math.max(GAMMA_MIN, gamma - 0.1); applyGamma(gamma); this.update(); }
        }
        GammaBar.prototype.options_ = { barName: 'volumeLevel', children: ['volumeLevel'] };
        if (!videojs.getComponent('GammaBar')) videojs.registerComponent('GammaBar', GammaBar);

        // Popover: shown on hover above the Gamma button
        const pop = document.createElement('div');
        pop.className = 'vjs-volume-control vjs-control vjs-volume-vertical';
        pop.style.cssText = 'position:absolute;display:none;z-index:10;transform:translateX(-50%);';

        const gammaBar = new GammaBar(player, { vertical: true });
        pop.appendChild(gammaBar.el());
        player.el().appendChild(pop);
        player.ready(() => gammaBar.update());

        // Prevent slider drags from bubbling to the player (avoids seek/pause)
        ['click', 'mousedown', 'pointerdown', 'touchstart'].forEach(ev =>
            pop.addEventListener(ev, e => e.stopPropagation())
        );

        // Control bar button
        const controlBar = player.getChild('controlBar');
        const btn = controlBar.addChild('button', {}, controlBar.children_.length - 2);
        const btnEl = btn.el();
        btnEl.querySelector('.vjs-icon-placeholder').classList.add('vjs-icon-spinner');
        btnEl.title = 'Gamma (hover to adjust)';

        const showPop = () => {
            const playerRect = player.el().getBoundingClientRect();
            const btnRect = btnEl.getBoundingClientRect();
            pop.style.left = (btnRect.left - playerRect.left + btnRect.width / 2) + 'px';
            pop.style.bottom = (playerRect.bottom - btnRect.top) + 'px';
            pop.style.display = 'block';
        };
        const hidePop = () => { pop.style.display = 'none'; };

        btnEl.addEventListener('mouseenter', showPop);
        btnEl.addEventListener('mouseleave', (e) => { if (!pop.contains(e.relatedTarget)) hidePop(); });
        pop.addEventListener('mouseleave', (e) => { if (!btnEl.contains(e.relatedTarget)) hidePop(); });
    }


    // ==========================================
    // Native Video.js Draw Plugin
    // ==========================================
    function drawPlugin() {
        const player = this;
        const videoEl = player.el().querySelector('video');
        if (!videoEl) return;

        const openDraw = () => {
            player.pause();

            const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
            const s = Math.min(window.innerWidth / vw, window.innerHeight / vh);
            const cw = Math.round(vw * s), ch = Math.round(vh * s);

            // Backdrop blocks player controls beneath the draw canvas
            const backdrop = document.createElement('div');
            backdrop.style.cssText = 'position:fixed;inset:0;z-index:1001;background:#000;';
            document.body.appendChild(backdrop);

            // Canvas sized to fit viewport, pixel dimensions = video resolution
            const canvas = document.createElement('canvas');
            canvas.width = vw; canvas.height = vh;
            canvas.style.cssText = `position:fixed;left:${(window.innerWidth-cw)/2}px;top:${(window.innerHeight-ch)/2}px;width:${cw}px;height:${ch}px;z-index:1002;cursor:crosshair;touch-action:none;`;
            document.body.appendChild(canvas);

            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoEl, 0, 0);
            const snapshot = canvas.toDataURL();

            // toCanvas: CSS px → canvas px
            const toC = (e) => ({ x: (e.clientX - canvas.offsetLeft) * vw / cw, y: (e.clientY - canvas.offsetTop) * vh / ch });

            const mkBtn = (text, bg) => {
                const b = document.createElement('button');
                b.textContent = text;
                b.style.cssText = `padding:4px 10px;border:none;border-radius:12px;cursor:pointer;background:${bg};color:#fff;font-size:12px;`;
                return b;
            };

            const colorPicker = document.createElement('input');
            colorPicker.type = 'color'; colorPicker.value = '#ff0000';
            colorPicker.title = 'Color';

            const sizeInput = document.createElement('input');
            sizeInput.type = 'range'; sizeInput.min = 1; sizeInput.max = 40; sizeInput.value = 4;
            sizeInput.style.cssText = 'width:80px;cursor:pointer;';

            const eraserBtn = mkBtn('Eraser', '#555');
            const clearBtn  = mkBtn('Clear', '#555');
            const saveBtn   = mkBtn('Save', '#e94560');
            const closeBtn  = mkBtn('✕', '#333');

            const toolbar = document.createElement('div');
            toolbar.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:1003;display:flex;align-items:center;gap:10px;background:rgba(0,0,0,0.7);padding:8px 14px;border-radius:24px;';
            toolbar.append(colorPicker, sizeInput, eraserBtn, clearBtn, saveBtn, closeBtn);
            document.body.appendChild(toolbar);

            const close = () => { backdrop.remove(); canvas.remove(); toolbar.remove(); };

            let erasing = false;
            eraserBtn.onclick = () => { erasing = !erasing; eraserBtn.style.background = erasing ? '#fff' : '#555'; eraserBtn.style.color = erasing ? '#000' : '#fff'; };
            clearBtn.onclick  = () => { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0); img.src = snapshot; };
            saveBtn.onclick   = () => { const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `draw-${Date.now()}.png`; a.click(); close(); };
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
    // Native Video.js Screenshot & Record Plugin
    // ==========================================
    function screenshotRecordPlugin() {
        const player = this;
        const videoEl = player.el().querySelector('video');
        if (!videoEl) return;

        const HOLD_MS = 500;
        let holdTimer = null;
        let recording = false;
        let mediaRecorder = null;
        let chunks = [];

        // ---- Preview overlay ----
        const makeOverlay = (contentEl, filename) => {
            const backdrop = document.createElement('div');
            backdrop.style.cssText = 'position:fixed;inset:0;z-index:1001;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;';

            contentEl.style.cssText = 'max-width:90vw;max-height:75vh;border-radius:6px;box-shadow:0 0 32px #000;';
            backdrop.appendChild(contentEl);

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:12px;';

            const dlBtn = document.createElement('button');
            dlBtn.textContent = 'Download';
            dlBtn.style.cssText = 'padding:8px 20px;background:#e94560;color:#fff;border:none;border-radius:5px;font-size:14px;cursor:pointer;';
            dlBtn.onclick = () => {
                const a = document.createElement('a');
                a.href = contentEl.src;
                a.download = filename;
                a.click();
                backdrop.remove();
            };

            const closeBtn = document.createElement('button');
            closeBtn.textContent = 'Discard';
            closeBtn.style.cssText = 'padding:8px 20px;background:#333;color:#fff;border:none;border-radius:5px;font-size:14px;cursor:pointer;';
            closeBtn.onclick = () => backdrop.remove();

            btnRow.append(dlBtn, closeBtn);
            backdrop.appendChild(btnRow);

            const onKey = (e) => { if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', onKey); } };
            document.addEventListener('keydown', onKey);
            backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });

            document.body.appendChild(backdrop);
        };

        // ---- Screenshot ----
        const takeScreenshot = () => {
            const canvas = document.createElement('canvas');
            canvas.width = videoEl.videoWidth;
            canvas.height = videoEl.videoHeight;
            canvas.getContext('2d').drawImage(videoEl, 0, 0);
            const img = document.createElement('img');
            img.src = canvas.toDataURL('image/png');
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            makeOverlay(img, `screenshot-${ts}.png`);
        };

        // ---- Recording ----
        let recSeconds = 0;
        let recInterval = null;

        const startRecording = () => {
            recording = true;
            btnEl.title = 'Recording… release to stop';
            chunks = [];
            recSeconds = 0;
            btnEl.textContent = '0s';
            btnEl.style.color = '#e94560';
            recInterval = setInterval(() => {
                recSeconds++;
                btnEl.textContent = recSeconds + 's';
            }, 1000);
            const stream = videoEl.captureStream();
            const mimeType = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4']
                .find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
            const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
            const videoBitsPerSecond = videoEl.videoWidth * videoEl.videoHeight * 30;
            mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
            mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            mediaRecorder.onstop = () => {
                recording = false;
                clearInterval(recInterval);
                btnEl.innerHTML = '<span class="vjs-icon-placeholder vjs-icon-circle"></span>';
                btnEl.style.color = '';
                btnEl.title = 'Screenshot / hold to record';
                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);
                const vid = document.createElement('video');
                vid.src = url;
                vid.controls = true;
                vid.autoplay = true;
                const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                makeOverlay(vid, `recording-${ts}.${ext}`);
            };
            mediaRecorder.start();
        };

        const stopRecording = () => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        };

        // ---- Control bar button ----
        const controlBar = player.getChild('controlBar');
        const btn = controlBar.addChild('button', {}, controlBar.children_.length - 2);
        const btnEl = btn.el();
        btnEl.querySelector('.vjs-icon-placeholder').classList.add('vjs-icon-circle');
        btnEl.title = 'Screenshot / hold to record';

        btnEl.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            holdTimer = setTimeout(() => {
                holdTimer = null;
                startRecording();
            }, HOLD_MS);
        });

        btnEl.addEventListener('pointerup', () => {
            if (holdTimer !== null) {
                clearTimeout(holdTimer);
                holdTimer = null;
                takeScreenshot();
            } else if (recording) {
                stopRecording();
            }
        });

        btnEl.addEventListener('pointerleave', () => {
            if (holdTimer !== null) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
        });
    }


    // ==========================================
    // Native Video.js Zoom & Pan Plugin
    // ==========================================
    function zoomPanPlugin() {
        const player = this;
        const videoEl = player.el().querySelector('video');
        if (!videoEl) return;

        const MIN_ZOOM = 1, MAX_ZOOM = 5;
        let zoom = 1, panX = 0, panY = 0;
        let active = false;
        let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

        videoEl.style.cssText += 'transform-origin:center center;will-change:transform;';

        const applyTransform = () => {
            videoEl.style.transform = zoom === 1
                ? ''
                : `scale(${zoom}) translate(${panX}px, ${panY}px)`;
        };

        const clampPan = () => {
            // Max pan distance scales with zoom so the video edge never goes past center
            const maxPan = (zoom - 1) / zoom * 50; // as % of half-dimension, in px terms via scale
            panX = Math.max(-maxPan * 20, Math.min(maxPan * 20, panX));
            panY = Math.max(-maxPan * 20, Math.min(maxPan * 20, panY));
        };

        const reset = () => {
            zoom = 1; panX = 0; panY = 0;
            applyTransform();
        };

        // Scroll to zoom (only when active)
        player.el().addEventListener('wheel', (e) => {
            if (!active) return;
            e.preventDefault();
            zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom - e.deltaY * 0.001 * zoom));
            if (zoom === MIN_ZOOM) { panX = 0; panY = 0; }
            clampPan();
            applyTransform();
        }, { passive: false });

        // Drag to pan
        player.el().addEventListener('mousedown', (e) => {
            if (!active || e.button !== 0) return;
            dragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            panStartX = panX;
            panStartY = panY;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            panX = panStartX + (e.clientX - dragStartX) / zoom;
            panY = panStartY + (e.clientY - dragStartY) / zoom;
            clampPan();
            applyTransform();
        });

        document.addEventListener('mouseup', () => { dragging = false; });

        // Double-click to reset
        player.el().addEventListener('dblclick', (e) => {
            if (!active) return;
            e.stopPropagation();
            reset();
        });

        // Control bar button — toggles pan mode, icon indicates state
        const controlBar = player.getChild('controlBar');
        const btn = controlBar.addChild('button', {}, controlBar.children_.length - 2);
        btn.el().querySelector('.vjs-icon-placeholder').classList.add('vjs-icon-fullscreen-enter');
        btn.el().title = 'Zoom & Pan (scroll to zoom, drag to pan, dblclick to reset)';

        btn.el().onclick = (e) => {
            e.stopPropagation();
            active = !active;
            player.el().style.cursor = active ? 'grab' : '';
            btn.el().style.opacity = active ? '1' : '0.5';
            player.options_.userActions = { click: !active };
            if (!active) reset();
        };

        btn.el().style.opacity = '0.5';
    }


    // ==========================================
    // Core Logic
    // ==========================================
    const activate = () => {
        const videos = Array.from(document.querySelectorAll('video'));
        const target = videos.sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];

        if (!target) return alert("No valid video found.");
        if (target.classList.contains('custom-vjs')) return;
        target.removeAttribute('style');
        target.className = 'custom-vjs';

        if (!window.videojs) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/video.js@8/dist/video-js.min.css';
            document.head.appendChild(link);

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/video.js@8/dist/video.min.js';
            document.head.appendChild(script);
            script.onload = () => initOverlay(target);
        } else {
            initOverlay(target);
        }
    };

    const initOverlay = (video) => {
        const overlay = document.createElement('div');
        document.querySelectorAll('*').forEach(el => {
            if (parseInt(getComputedStyle(el).zIndex) > 1000) el.style.zIndex = '0';
        });

        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:1000;background:#000;overflow:hidden;';
        overlay.appendChild(video);
        document.body.removeAttribute('style');
        document.body.style.overflow = 'hidden';
        document.body.appendChild(overlay);

        video.removeAttribute('style');
        video.style.width = '100%';
        video.style.height = '100%';
        video.classList.add('video-js', 'vjs-default-skin');
        video.controls = true;

        window.videojs = videojs;

        [srtLoaderPlugin, gammaSliderPlugin, zoomPanPlugin, screenshotRecordPlugin, drawPlugin].forEach(p => {
            if (!videojs.getPlugin(p.name)) videojs.registerPlugin(p.name, p);
        });

        // Set default text track settings to no background and uniform edge
        localStorage.setItem('vjs-text-track-settings', JSON.stringify({
            backgroundOpacity: '0',
            edgeStyle: 'uniform'
        }));

        videojs(video, {
            playbackRates: [0.5, 1, 1.5, 2],
            persistTextTrackSettings: true
        }, function () {
            this.srtLoaderPlugin();
            this.gammaSliderPlugin();
            this.zoomPanPlugin();
            this.screenshotRecordPlugin();
            this.drawPlugin();
            this.play();
        });
    };

    GM_registerMenuCommand("▶ VideoZen", activate);
})();
