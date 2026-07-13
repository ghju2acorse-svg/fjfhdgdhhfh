(function(){
  "use strict";

  /* ================= theme toggle ================= */
  var themeToggle = document.getElementById('themeToggle');
  var moonIcon = document.getElementById('themeIconMoon');
  var sunIcon = document.getElementById('themeIconSun');

  function currentTheme(){
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  function syncThemeIcon(){
    var isLight = currentTheme() === 'light';
    moonIcon.style.display = isLight ? 'none' : '';
    sunIcon.style.display = isLight ? '' : 'none';
  }
  function setTheme(theme){
    document.documentElement.setAttribute('data-theme', theme);
    try{ localStorage.setItem('flashino-theme', theme); } catch(e){}
    syncThemeIcon();
    Starfield.setTheme(theme);
  }
  syncThemeIcon();
  if(themeToggle){
    themeToggle.addEventListener('click', function(){
      setTheme(currentTheme() === 'light' ? 'dark' : 'light');
    });
  }

  /* ================= starfield background ================= */
  var Starfield = (function(){
    var canvas = document.getElementById('starfield');
    var ctx = canvas ? canvas.getContext('2d') : null;
    var stars = [];
    var w = 0, h = 0, dpr = 1;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var colors = { a: '#A47CFF', b: '#F6F7FC' }; // purple + white (dark theme)
    var raf = null;

    function computedColor(varName){
      return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    }

    function resize(){
      if(!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function buildStars(){
      var count = Math.round((w * h) / 9000); // density scales with screen size
      count = Math.max(70, Math.min(220, count));
      stars = [];
      for(var i = 0; i < count; i++){
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.4 + 0.4,
          isPurple: Math.random() < 0.38,
          baseAlpha: Math.random() * 0.5 + 0.35,
          twinkleSpeed: Math.random() * 0.015 + 0.004,
          twinklePhase: Math.random() * Math.PI * 2,
          vx: (Math.random() - 0.5) * 0.06,
          vy: (Math.random() - 0.5) * 0.06 + 0.02
        });
      }
    }

    function tick(t){
      if(!ctx) return;
      ctx.clearRect(0, 0, w, h);
      for(var i = 0; i < stars.length; i++){
        var s = stars[i];
        if(!reduceMotion){
          s.x += s.vx;
          s.y += s.vy;
          if(s.x < -5) s.x = w + 5;
          if(s.x > w + 5) s.x = -5;
          if(s.y < -5) s.y = h + 5;
          if(s.y > h + 5) s.y = -5;
        }
        var alpha = reduceMotion ? s.baseAlpha : s.baseAlpha + Math.sin(t * s.twinkleSpeed + s.twinklePhase) * 0.25;
        alpha = Math.max(0.08, Math.min(1, alpha));
        ctx.beginPath();
        ctx.fillStyle = s.isPurple ? colors.a : colors.b;
        ctx.globalAlpha = alpha;
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    }

    function start(){
      if(!canvas) return;
      resize();
      buildStars();
      colors.a = computedColor('--star-a') || colors.a;
      colors.b = computedColor('--star-b') || colors.b;
      if(raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }

    window.addEventListener('resize', function(){
      resize();
      buildStars();
    });

    return {
      init: start,
      setTheme: function(){
        colors.a = computedColor('--star-a') || colors.a;
        colors.b = computedColor('--star-b') || colors.b;
      }
    };
  })();
  Starfield.init();

  /* ================= API helper ================= */
  var Api = {
    call: function(method, url, body){
      var opts = { method: method, credentials: 'same-origin', headers: {} };
      if(body !== undefined){ opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
      return fetch(url, opts).then(function(res){
        return res.json().catch(function(){ return null; }).then(function(data){
          if(!res.ok){
            var err = new Error((data && data.error) || 'Request failed');
            err.status = res.status;
            throw err;
          }
          return data;
        });
      });
    },
    get: function(url){ return this.call('GET', url); },
    post: function(url, body){ return this.call('POST', url, body === undefined ? {} : body); }
  };

  function fmt(n){
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function escapeHtml(s){
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  var toastHideTimer = null;
  function showToast(message){
    var el = document.getElementById('appToast');
    if(!el){
      el = document.createElement('div');
      el.id = 'appToast';
      el.className = 'app-toast';
      el.innerHTML = '<span class="app-toast-bar"></span><span class="app-toast-text"></span>';
      document.body.appendChild(el);
    }
    el.querySelector('.app-toast-text').textContent = message;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    if(toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(function(){ el.classList.remove('show'); }, 3800);
  }

  /* ================= app state ================= */
  var App = { user: null };
  var CHAT_MIN_LEVEL = 3;

  function xpProgress(u){
    var width = 150;
    var levelStart = (u.level - 1) * width;
    var into = Math.max(0, u.xp - levelStart);
    var pct = Math.max(0, Math.min(100, (into / width) * 100));
    return { into: into, width: width, pct: pct };
  }

  function applyWallet(walletPatch){
    if(!walletPatch || !App.user) return;
    App.user.balance = walletPatch.balance;
    if(walletPatch.level !== undefined) App.user.level = walletPatch.level;
    if(walletPatch.xp !== undefined) App.user.xp = walletPatch.xp;
    renderUser();
  }

  function renderUser(){
    var walletAmount = document.getElementById('walletAmount');
    var wdSabAmount = document.getElementById('wdSabAmount');
    var gmBalance = document.getElementById('gmBalance');
    var walletBtnEl = document.getElementById('walletBtn');
    var walletBtnSecondaryEl = document.getElementById('walletBtnSecondary');
    var navAvatar = document.getElementById('navAvatar');
    var navUsername = document.getElementById('navUsername');
    var welcomeAvatar = document.getElementById('welcomeAvatar');
    var welcomeName = document.getElementById('welcomeName');
    var welcomeLevelBadge = document.getElementById('welcomeLevelBadge');
    var xpFill = document.getElementById('xpFill');
    var xpLevel = document.getElementById('xpLevel');
    var xpNums = document.getElementById('xpNums');
    var dropdownAccountLine = document.getElementById('dropdownAccountLine');
    var logoutLinkEl = document.getElementById('logoutLink');

    if(!App.user){
      if(walletAmount) walletAmount.textContent = '0.00';
      if(wdSabAmount) wdSabAmount.textContent = '0.00';
      if(gmBalance) gmBalance.textContent = '0.00';
      if(walletBtnEl){
        walletBtnEl.classList.add('guest');
      }
      if(walletBtnSecondaryEl) walletBtnSecondaryEl.style.display = 'none';
      if(navAvatar) navAvatar.textContent = '?';
      if(navUsername) navUsername.textContent = 'Guest';
      if(welcomeAvatar) welcomeAvatar.textContent = '?';
      if(welcomeName) welcomeName.textContent = 'Guest';
      if(welcomeLevelBadge) welcomeLevelBadge.textContent = '–';
      if(xpFill) xpFill.style.width = '0%';
      if(xpLevel) xpLevel.textContent = '1';
      if(xpNums) xpNums.textContent = '0 / 150';
      if(dropdownAccountLine) dropdownAccountLine.textContent = 'Not logged in';
      if(logoutLinkEl) logoutLinkEl.style.display = 'none';
      if(typeof closeWalletDropdown === 'function') closeWalletDropdown();
      refreshChatGate();
      return;
    }
    var u = App.user;
    var initial = u.username.charAt(0).toUpperCase();
    if(walletAmount) walletAmount.textContent = fmt(u.balance);
    if(wdSabAmount) wdSabAmount.textContent = fmt(u.balance);
    if(gmBalance) gmBalance.textContent = fmt(u.balance);
    if(walletBtnEl){
      walletBtnEl.classList.remove('guest');
    }
    if(walletBtnSecondaryEl) walletBtnSecondaryEl.style.display = '';
    if(navAvatar) navAvatar.textContent = initial;
    if(navUsername) navUsername.textContent = u.username;
    if(welcomeAvatar) welcomeAvatar.textContent = initial;
    if(welcomeName) welcomeName.textContent = u.username;
    if(welcomeLevelBadge) welcomeLevelBadge.textContent = u.level;
    if(xpFill){
      var xp = xpProgress(u);
      xpFill.style.width = xp.pct + '%';
      if(xpLevel) xpLevel.textContent = u.level;
      if(xpNums) xpNums.textContent = xp.into + ' / ' + xp.width;
    }
    if(dropdownAccountLine) dropdownAccountLine.textContent = 'Level ' + u.level + ' · ' + fmt(u.balance) + ' credits';
    if(logoutLinkEl) logoutLinkEl.style.display = '';
    refreshChatGate();
  }

  function refreshMe(){
    return Api.get('/api/me').then(function(data){
      App.user = data.user;
      renderUser();
      return App.user;
    });
  }

  /* ---------- mobile menu ---------- */
  var menuToggle = document.getElementById('menuToggle');
  var navLinks = document.querySelector('.nav-links');
  if(menuToggle){
    menuToggle.addEventListener('click', function(){
      var open = navLinks.style.display === 'flex';
      navLinks.style.display = open ? 'none' : 'flex';
      navLinks.style.cssText += open ? '' : 'position:absolute;top:76px;left:0;right:0;background:var(--bg);flex-direction:column;padding:20px 24px;border-bottom:1px solid var(--outline-soft);gap:18px;';
    });
  }

  /* ================= modals ================= */
  var overlays = {
    auth: document.getElementById('modal-auth'),
    roblox: document.getElementById('modal-roblox')
  };
  var lastFocused = null;
  var currentGameCleanup = null;
  var gameRoundLocked = false; // true while a bet is committed and the round hasn't resolved yet

  // There's no modal to lock anymore — each game lives on its own page.
  // "Can't get out of it" now means: don't let nav links carry you away,
  // and warn on tab-close/refresh, until the round actually resolves.
  function setRoundLocked(locked){
    gameRoundLocked = locked;
    document.body.classList.toggle('round-locked', locked);
  }
  window.addEventListener('beforeunload', function(e){
    if(!gameRoundLocked) return;
    e.preventDefault();
    e.returnValue = '';
  });
  document.addEventListener('click', function(e){
    if(!gameRoundLocked) return;
    var link = e.target.closest && e.target.closest('a[href]');
    if(!link) return;
    e.preventDefault();
    showToast('🔒 Finish your round before leaving this page.');
  }, true);

  function openModal(name){
    var m = overlays[name];
    if(!m) return;
    lastFocused = document.activeElement;
    m.classList.add('open');
    var firstInput = m.querySelector('input:not([disabled])');
    if(firstInput) firstInput.focus();
    document.body.style.overflow = 'hidden';
  }
  function closeModal(m){
    m.classList.remove('open');
    document.body.style.overflow = '';
    if(lastFocused) lastFocused.focus();
  }
  function requireLogin(){
    if(App.user) return true;
    setAuthMode('register');
    openModal('auth');
    return false;
  }

  document.querySelectorAll('[data-modal-open]').forEach(function(btn){
    btn.addEventListener('click', function(){
      openModal(btn.getAttribute('data-modal-open'));
    });
  });
  document.querySelectorAll('[data-modal-close]').forEach(function(btn){
    btn.addEventListener('click', function(){ closeModal(btn.closest('.modal-overlay')); });
  });
  Object.keys(overlays).forEach(function(key){
    var m = overlays[key];
    if(!m) return;
    m.addEventListener('click', function(e){ if(e.target === m) closeModal(m); });
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      Object.keys(overlays).forEach(function(key){
        if(overlays[key] && overlays[key].classList.contains('open')) closeModal(overlays[key]);
      });
    }
  });

  /* ---------- profile dropdown ---------- */
  var profileToggle = document.getElementById('profileToggle');
  var profileDropdown = document.getElementById('profileDropdown');
  if(profileToggle){
    profileToggle.addEventListener('click', function(e){
      e.stopPropagation();
      if(!App.user){ requireLogin(); return; } // guest: nothing to show in a profile dropdown — go straight to sign in
      var open = profileToggle.getAttribute('aria-expanded') === 'true';
      profileToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      profileDropdown.classList.toggle('open', !open);
      if(typeof closeWalletDropdown === 'function') closeWalletDropdown();
    });
    document.addEventListener('click', function(e){
      if(!profileDropdown.contains(e.target) && e.target !== profileToggle){
        profileToggle.setAttribute('aria-expanded', 'false');
        profileDropdown.classList.remove('open');
      }
    });
  }
  var logoutLink = document.getElementById('logoutLink');
  if(logoutLink){
    logoutLink.addEventListener('click', function(e){
      e.preventDefault();
      Api.post('/api/logout').then(function(){
        App.user = null;
        renderUser();
        profileDropdown.classList.remove('open');
      });
    });
  }

  /* ---------- wallet dropdown ---------- */
  var walletBtn = document.getElementById('walletBtn');
  var walletBtnSecondary = document.getElementById('walletBtnSecondary');
  var walletDropdown = document.getElementById('walletDropdown');
  function closeWalletDropdown(){
    if(walletBtn) walletBtn.setAttribute('aria-expanded', 'false');
    if(walletBtnSecondary) walletBtnSecondary.setAttribute('aria-expanded', 'false');
    if(walletDropdown) walletDropdown.classList.remove('open');
  }
  function toggleWalletDropdown(triggerBtn){
    if(!App.user){ requireLogin(); return; }
    var isOpen = walletDropdown.classList.contains('open');
    closeWalletDropdown();
    if(!isOpen){
      walletDropdown.classList.add('open');
      triggerBtn.setAttribute('aria-expanded', 'true');
    }
    profileToggle.setAttribute('aria-expanded', 'false');
    profileDropdown.classList.remove('open');
  }
  [walletBtn, walletBtnSecondary].forEach(function(btn){
    if(!btn) return;
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      toggleWalletDropdown(btn);
    });
  });
  document.addEventListener('click', function(e){
    if(!walletDropdown) return;
    if(!walletDropdown.contains(e.target) && e.target !== walletBtn && e.target !== walletBtnSecondary){
      closeWalletDropdown();
    }
  });
  var walletInfoToggle = document.getElementById('walletInfoToggle');
  var walletInfoText = document.getElementById('walletInfoText');
  if(walletInfoToggle){
    walletInfoToggle.addEventListener('click', function(e){
      e.stopPropagation();
      walletInfoText.classList.toggle('open');
    });
  }
  var walletFunYes = document.getElementById('walletFunYes');
  var walletFunNo = document.getElementById('walletFunNo');
  if(walletFunYes) walletFunYes.addEventListener('click', function(e){ e.stopPropagation(); showToast('Yes!'); });
  if(walletFunNo) walletFunNo.addEventListener('click', function(e){ e.stopPropagation(); showToast('No!'); });

  /* ---------- coin rain countdown (a real, functioning clock — not a claim about live activity) ---------- */
  var rainTimerEl = document.getElementById('rainTimer');
  if(rainTimerEl){
    var remaining = 60 * 60;
    setInterval(function(){
      remaining = remaining > 0 ? remaining - 1 : 60 * 60;
      var m = Math.floor(remaining / 60), s = remaining % 60;
      rainTimerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
  }

  /* ---------- reset demo balance ---------- */
  var resetBtn = document.getElementById('resetBalanceBtn');
  if(resetBtn){
    resetBtn.addEventListener('click', function(){
      resetBtn.disabled = true;
      Api.post('/api/reset-demo').then(function(data){
        App.user = data.user;
        renderUser();
        resetBtn.disabled = false;
      }).catch(function(){ resetBtn.disabled = false; });
    });
  }

  /* ================= auth ================= */
  var authMode = 'register';
  var authUserInput = document.getElementById('authUser');
  var authUserStatus = document.getElementById('authUserStatus');

  function setAuthMode(mode){
    authMode = mode;
    document.getElementById('authTitle').textContent = mode === 'register' ? 'Create your account' : 'Welcome back';
    document.getElementById('authSubmitBtn').textContent = mode === 'register' ? 'Create account' : 'Log in';
    document.getElementById('authSwitchText').textContent = mode === 'register' ? 'Already have an account?' : 'New here?';
    document.getElementById('authSwitchLink').textContent = mode === 'register' ? 'Log in' : 'Create one';
    document.getElementById('authError').textContent = '';
    if(authUserStatus){ authUserStatus.textContent = ''; }
  }
  var authSwitchLink = document.getElementById('authSwitchLink');
  if(authSwitchLink){
    authSwitchLink.addEventListener('click', function(e){
      e.preventDefault();
      setAuthMode(authMode === 'register' ? 'login' : 'register');
    });
  }

  // Live availability check while typing — only meaningful when creating
  // an account. The server's /api/register is still the real gatekeeper
  // (see server.js); this is purely so people find out *before* hitting
  // submit rather than after.
  var usernameCheckTimer = null;
  var lastCheckedAvailable = null;
  if(authUserInput){
    authUserInput.addEventListener('input', function(){
      lastCheckedAvailable = null;
      if(authMode !== 'register'){ authUserStatus.textContent = ''; return; }
      var value = authUserInput.value.trim();
      if(usernameCheckTimer) clearTimeout(usernameCheckTimer);
      if(!value){ authUserStatus.textContent = ''; return; }
      if(!/^[A-Za-z0-9_]{3,20}$/.test(value)){
        authUserStatus.textContent = '3–20 characters: letters, numbers, underscores.';
        authUserStatus.style.color = 'var(--text-3)';
        return;
      }
      authUserStatus.textContent = 'Checking…';
      authUserStatus.style.color = 'var(--text-3)';
      usernameCheckTimer = setTimeout(function(){
        Api.get('/api/check-username?u=' + encodeURIComponent(value)).then(function(res){
          if(authUserInput.value.trim() !== value) return; // stale response, user kept typing
          lastCheckedAvailable = res.available;
          if(res.available){
            authUserStatus.textContent = '✓ Username available';
            authUserStatus.style.color = 'var(--teal)';
          } else {
            authUserStatus.textContent = '✕ Someone already has that username';
            authUserStatus.style.color = 'var(--red)';
          }
        }).catch(function(){ authUserStatus.textContent = ''; });
      }, 350);
    });
  }

  var authForm = document.getElementById('authForm');
  if(authForm){
    authForm.addEventListener('submit', function(e){
      e.preventDefault();
      var username = document.getElementById('authUser').value.trim();
      var password = document.getElementById('authPass').value;
      var errEl = document.getElementById('authError');
      var btn = document.getElementById('authSubmitBtn');
      errEl.textContent = '';
      if(authMode === 'register' && lastCheckedAvailable === false){
        errEl.textContent = 'That username is taken — pick another.';
        return;
      }
      btn.disabled = true;
      var url = authMode === 'register' ? '/api/register' : '/api/login';
      Api.post(url, { username: username, password: password }).then(function(res){
        App.user = res.user;
        renderUser();
        closeModal(overlays.auth);
        authForm.reset();
        authUserStatus.textContent = '';
        lastCheckedAvailable = null;
        loadChat();
        if(res.bonus){
          showToast('+' + fmt(res.bonus) + ' SAB — daily login bonus');
        }
        // Prompt to link Roblox right after sign-in if not linked yet —
        // this is the "show it when you click sign in" behavior, rather
        // than making people dig for it in the profile dropdown.
        if(!App.user.robloxLinked && overlays.roblox){
          setTimeout(function(){ openModal('roblox'); }, 350);
        }
      }).catch(function(err){
        errEl.textContent = err.message;
      }).finally(function(){ btn.disabled = false; });
    });
  }

  /* ================= roblox account linking ================= */
  var robloxStartForm = document.getElementById('robloxStartForm');
  var robloxStartBtn = document.getElementById('robloxStartBtn');
  var robloxStartError = document.getElementById('robloxStartError');
  var robloxCodeStep = document.getElementById('robloxCodeStep');
  var robloxCodeDisplay = document.getElementById('robloxCodeDisplay');
  var robloxJoinLink = document.getElementById('robloxJoinLink');
  var robloxStatusText = document.getElementById('robloxStatusText');
  var robloxCopyBtn = document.getElementById('robloxCopyBtn');
  var robloxPollTimer = null;

  function resetRobloxModal(){
    if(!robloxStartForm) return;
    robloxStartForm.style.display = '';
    robloxCodeStep.style.display = 'none';
    robloxStartError.textContent = '';
    document.getElementById('robloxUser').value = '';
    robloxStatusText.textContent = 'Waiting for verification…';
    if(robloxPollTimer){ clearInterval(robloxPollTimer); robloxPollTimer = null; }
  }

  if(robloxStartForm){
    robloxStartForm.addEventListener('submit', function(e){
      e.preventDefault();
      var username = document.getElementById('robloxUser').value.trim();
      if(!username) return;
      robloxStartBtn.disabled = true;
      robloxStartError.textContent = '';
      Api.post('/api/roblox/link/start', { robloxUsername: username }).then(function(res){
        // res: { code, joinUrl }
        robloxCodeDisplay.textContent = res.code;
        robloxJoinLink.href = res.joinUrl;
        robloxStartForm.style.display = 'none';
        robloxCodeStep.style.display = 'block';
        startRobloxPolling();
      }).catch(function(err){
        robloxStartError.textContent = err.message;
      }).finally(function(){
        robloxStartBtn.disabled = false;
      });
    });
  }

  if(robloxCopyBtn){
    robloxCopyBtn.addEventListener('click', function(){
      navigator.clipboard.writeText(robloxCodeDisplay.textContent).then(function(){
        showToast('Code copied');
      });
    });
  }

  function startRobloxPolling(){
    if(robloxPollTimer) clearInterval(robloxPollTimer);
    robloxPollTimer = setInterval(function(){
      Api.get('/api/roblox/link/status').then(function(res){
        if(res.status === 'verified'){
          clearInterval(robloxPollTimer);
          robloxPollTimer = null;
          robloxStatusText.textContent = 'Verified!';
          showToast('Roblox account linked');
          if(App.user){ App.user.robloxLinked = true; App.user.robloxUsername = res.robloxUsername; }
          setTimeout(function(){ closeModal(overlays.roblox); resetRobloxModal(); }, 900);
        } else if(res.status === 'expired'){
          clearInterval(robloxPollTimer);
          robloxPollTimer = null;
          robloxStatusText.textContent = 'Code expired — close and try again.';
        }
        // status === 'pending' -> keep polling
      }).catch(function(){ /* transient network error, keep polling */ });
    }, 2500);
  }

  // Reset the Roblox modal's state whenever it's closed, whether via the
  // close button, backdrop click, or Escape key.
  if(overlays.roblox){
    document.querySelectorAll('[data-modal-close]').forEach(function(btn){
      if(btn.closest('.modal-overlay') === overlays.roblox){
        btn.addEventListener('click', resetRobloxModal);
      }
    });
    overlays.roblox.addEventListener('click', function(e){
      if(e.target === overlays.roblox) resetRobloxModal();
    });
  }

  /* ================= chat ================= */
  var chatInput = document.getElementById('chatInput');
  var chatSendBtn = document.getElementById('chatSendBtn');
  var chatForm = document.getElementById('chatForm');
  var chatMessages = document.getElementById('chatMessages');
  var chatGateNote = document.getElementById('chatGateNote');

  function refreshChatGate(){
    if(!chatInput) return;
    var unlocked = App.user && App.user.level >= CHAT_MIN_LEVEL;
    chatInput.disabled = !unlocked;
    chatSendBtn.disabled = !unlocked;
    if(!App.user){
      chatInput.placeholder = 'Log in to chat';
      chatGateNote.textContent = 'Log in to join the chat.';
    } else if(unlocked){
      chatInput.placeholder = 'Send a message';
      chatGateNote.textContent = '✅ Chat unlocked at Level ' + App.user.level + '.';
    } else {
      chatInput.placeholder = 'Reach Level 3 to chat';
      chatGateNote.textContent = '🔒 Chat unlocks at Level 3 — you\'re Level ' + App.user.level + '.';
    }
  }

  function renderChatMessages(messages){
    if(!messages.length){
      chatMessages.innerHTML = '<div class="chat-empty">No messages yet — be the first to say something.</div>';
      return;
    }
    var wasAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 30;
    chatMessages.innerHTML = messages.map(function(m){
      return '<div class="chat-msg"><b>' + escapeHtml(m.username) + '</b><span>' + escapeHtml(m.message) + '</span></div>';
    }).join('');
    if(wasAtBottom) chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function loadChat(){
    if(!App.user) return;
    Api.get('/api/chat').then(function(data){ renderChatMessages(data.messages); }).catch(function(){});
  }

  if(chatForm){
    chatForm.addEventListener('submit', function(e){
      e.preventDefault();
      if(!App.user || App.user.level < CHAT_MIN_LEVEL) return;
      var message = chatInput.value.trim();
      if(!message) return;
      chatInput.value = '';
      Api.post('/api/chat', { message: message }).then(loadChat).catch(function(err){
        chatGateNote.textContent = err.message;
      });
    });
  }

  /* ================= shared game-modal helpers ================= */
  function betControlsHTML(defaultBet){
    return '<div class="bet-row">'
      + '<input type="number" id="betInput" min="1" step="1" value="' + defaultBet + '">'
      + '<div class="bet-quick">'
      + '<button type="button" data-bet-op="half">½</button>'
      + '<button type="button" data-bet-op="double">2×</button>'
      + '<button type="button" data-bet-op="max">Max</button>'
      + '</div></div>';
  }
  function wireBetControls(){
    var betInput = document.getElementById('betInput');
    document.querySelectorAll('[data-bet-op]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var v = parseFloat(betInput.value) || 0;
        var op = btn.getAttribute('data-bet-op');
        var bal = App.user ? App.user.balance : 0;
        if(op === 'half') v = Math.max(1, Math.floor(v / 2));
        if(op === 'double') v = Math.min(Math.floor(bal), Math.max(1, v * 2));
        if(op === 'max') v = Math.max(1, Math.floor(bal));
        betInput.value = v;
      });
    });
    return betInput;
  }
  function currentBet(betInput){
    return Math.max(1, Math.floor(parseFloat(betInput.value) || 0));
  }
  function showMsg(el, text, cls){
    el.className = 'game-msg ' + (cls || 'info');
    el.textContent = text;
  }
  function syncGmBalance(){
    var gmBalance = document.getElementById('gmBalance');
    if(gmBalance && App.user) gmBalance.textContent = fmt(App.user.balance);
  }

  // Real recent rounds for this game, across all players — nothing here
  // is fabricated. Refreshes periodically so it feels alive without
  // faking a "users online" style number.
  function loadRecentActivity(gameKey){
    var list = document.getElementById('activityList');
    if(!list) return;
    function render(){
      Api.get('/api/recent-rounds?game=' + encodeURIComponent(gameKey) + '&limit=12').then(function(data){
        if(!data.rounds || !data.rounds.length){
          list.innerHTML = '<div class="activity-empty">No rounds played yet — be the first.</div>';
          return;
        }
        list.innerHTML = data.rounds.map(function(r){
          var net = r.net;
          var cls = net >= 0 ? 'win' : 'lose';
          var sign = net >= 0 ? '+' : '';
          return '<div class="activity-row"><span class="who">' + escapeHtml(r.username) + '</span>'
            + '<span class="amt ' + cls + '">' + sign + fmt(net) + '</span></div>';
        }).join('');
      }).catch(function(){});
    }
    render();
    setInterval(render, 8000);
  }

  /* ================= games ================= */
  var GAME_META = {
    crash:       { title: 'Crash',        sub: 'Cash out before it crashes.' },
    coinflip:    { title: 'Coinflip',     sub: 'Pick a side. 2× payout.' },
    mines:       { title: 'Mines',        sub: 'Reveal gems, avoid mines, cash out anytime.' },
    casebattles: { title: 'Case Battles', sub: 'Open a case, see what you land.' },
    upgrader:    { title: 'Upgrader',     sub: 'Risk it for a bigger multiplier.' },
    blackjack:   { title: 'Blackjack',    sub: 'Beat the dealer to 21.' },
    roulette:    { title: 'Roulette',     sub: 'Red, black, or green.' }
  };
  var Games = {};

  Games.coinflip = {
    mount: function(stage){
      var choice = null;
      var rotation = 0;
      var youInitial = (App.user && App.user.username ? App.user.username.charAt(0).toUpperCase() : '?');
      stage.innerHTML =
        '<div class="coin-vs-row">'
        + '<div class="coin-vs-side"><div class="coin-vs-avatar you">' + youInitial + '</div>'
        + '<div class="coin-vs-name">' + (App.user ? escapeHtml(App.user.username) : 'You') + '</div>'
        + '<div class="coin-vs-chance">49% to win</div></div>'
        + '<div class="coin-vs-side"><div class="coin-vs-avatar house"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg></div>'
        + '<div class="coin-vs-name">House</div>'
        + '<div class="coin-vs-chance">51% edge</div></div>'
        + '</div>'
        + '<div class="coin-pick">'
        + '<button type="button" data-side="heads">HEADS</button>'
        + '<button type="button" data-side="tails">TAILS</button>'
        + '</div>'
        + '<div class="coin-stage"><div class="coin-toss-wrap" id="cfTossWrap"><div class="coin-3d" id="cfCoin">'
        + '<div class="coin-face coin-face-heads">H</div>'
        + '<div class="coin-face coin-face-tails">T</div>'
        + '</div></div></div>'
        + betControlsHTML(10)
        + '<div class="game-msg info" id="cfMsg">Pick a side and place your bet.</div>'
        + '<div class="game-actions"><button type="button" class="btn btn-primary" id="cfPlay">Flip</button></div>';

      var betInput = wireBetControls();
      var msg = document.getElementById('cfMsg');
      var tossWrap = document.getElementById('cfTossWrap');
      var coin = document.getElementById('cfCoin');
      var playBtn = document.getElementById('cfPlay');

      stage.querySelectorAll('[data-side]').forEach(function(btn){
        btn.addEventListener('click', function(){
          stage.querySelectorAll('[data-side]').forEach(function(b){ b.classList.remove('selected'); });
          btn.classList.add('selected');
          choice = btn.getAttribute('data-side');
        });
      });

      playBtn.addEventListener('click', function(){
        if(!choice) return showMsg(msg, 'Pick heads or tails first.', 'info');
        var bet = currentBet(betInput);
        playBtn.disabled = true;
        setRoundLocked(true);
        tossWrap.classList.remove('tossing');
        void tossWrap.offsetWidth;
        tossWrap.classList.add('tossing');
        showMsg(msg, 'Flipping…', 'info');

        Api.post('/api/games/coinflip', { bet: bet, choice: choice }).then(function(res){
          var desiredMod = res.result === 'heads' ? 0 : 180;
          var currentMod = ((rotation % 360) + 360) % 360;
          var delta = ((desiredMod - currentMod) % 360 + 360) % 360;
          rotation = rotation + delta + 5 * 360;
          coin.style.transform = 'rotateY(' + rotation + 'deg)';

          setTimeout(function(){
            applyWallet(res.wallet);
            syncGmBalance();
            showMsg(msg, res.won ? ('You won +' + fmt(res.payout - bet)) : ('You lost -' + fmt(bet)), res.won ? 'win' : 'lose');
            playBtn.disabled = false;
            setRoundLocked(false);
          }, 1350);
        }).catch(function(err){
          setRoundLocked(false);
          showMsg(msg, err.message, 'lose');
          playBtn.disabled = false;
        });
      });
    }
  };

  var ROULETTE_RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  function rouletteSegColor(n){
    if(n === 0) return '#22D3B6';
    return ROULETTE_RED_NUMBERS.indexOf(n) > -1 ? '#E23A54' : '#1B1D25';
  }
  function rouletteWheelGradient(){
    var slice = 100 / 37;
    var stops = [];
    for(var i = 0; i < 37; i++){
      stops.push(rouletteSegColor(i) + ' ' + (i * slice).toFixed(4) + '% ' + ((i + 1) * slice).toFixed(4) + '%');
    }
    return 'conic-gradient(from 0deg, ' + stops.join(', ') + ')';
  }

  Games.roulette = {
    mount: function(stage){
      var choice = null;
      var rotation = 0;
      stage.innerHTML =
        '<div class="roulette-picks">'
        + '<button type="button" data-color="red">RED · 2×</button>'
        + '<button type="button" data-color="black">BLACK · 2×</button>'
        + '<button type="button" data-color="green">GREEN · 14×</button>'
        + '</div>'
        + '<div class="wheel-stage">'
        + '<div class="wheel-pointer"></div>'
        + '<div class="wheel-disc" id="rlDisc" style="background:' + rouletteWheelGradient() + ';"></div>'
        + '<div class="wheel-hub" id="rlHub">?</div>'
        + '</div>'
        + betControlsHTML(10)
        + '<div class="game-msg info" id="rlMsg">Pick a color and place your bet.</div>'
        + '<div class="game-actions"><button type="button" class="btn btn-primary" id="rlPlay">Spin</button></div>';

      var betInput = wireBetControls();
      var msg = document.getElementById('rlMsg');
      var disc = document.getElementById('rlDisc');
      var hub = document.getElementById('rlHub');
      var playBtn = document.getElementById('rlPlay');

      stage.querySelectorAll('[data-color]').forEach(function(btn){
        btn.addEventListener('click', function(){
          stage.querySelectorAll('[data-color]').forEach(function(b){ b.classList.remove('selected'); });
          btn.classList.add('selected');
          choice = btn.getAttribute('data-color');
        });
      });

      playBtn.addEventListener('click', function(){
        if(!choice) return showMsg(msg, 'Pick a color first.', 'info');
        var bet = currentBet(betInput);
        playBtn.disabled = true;
        setRoundLocked(true);
        hub.className = 'wheel-hub';
        hub.textContent = '';
        showMsg(msg, 'Spinning…', 'info');

        Api.post('/api/games/roulette', { bet: bet, choice: choice }).then(function(res){
          var slice = 360 / 37;
          var segCenterDeg = (res.landed + 0.5) * slice;
          var targetMod = ((-segCenterDeg % 360) + 360) % 360;
          var currentMod = ((rotation % 360) + 360) % 360;
          var delta = ((targetMod - currentMod) % 360 + 360) % 360;
          rotation = rotation + delta + 6 * 360; // 6 full spins for effect, then lands exactly right
          disc.style.transform = 'rotate(' + rotation + 'deg)';

          setTimeout(function(){
            hub.textContent = res.landed;
            hub.className = 'wheel-hub ' + (res.won ? 'win' : 'lose');
            applyWallet(res.wallet);
            syncGmBalance();
            showMsg(msg, res.won ? ('You won +' + fmt(res.payout - bet)) : ('You lost -' + fmt(bet)), res.won ? 'win' : 'lose');
            playBtn.disabled = false;
            setRoundLocked(false);
          }, 3650);
        }).catch(function(err){
          setRoundLocked(false);
          showMsg(msg, err.message, 'lose');
          playBtn.disabled = false;
        });
      });
    }
  };

  Games.upgrader = {
    mount: function(stage){
      var MIN_CHANCE = 0.05, MAX_CHANCE = 0.95, HOUSE_EDGE = 0.04;
      var chance = 0.50;
      var needleRotation = 0;
      var dragging = false;

      stage.innerHTML =
        '<div class="upg-stage" id="upgStage">'
        + '<div class="upg-ring" id="upgRing"></div>'
        + '<div class="upg-needle" id="upgNeedle"><div class="upg-needle-tip"></div></div>'
        + '<div class="upg-ring-hole"></div>'
        + '<div class="upg-readout"><div class="upg-chance-val" id="upgChanceVal">50.0%</div><div class="upg-mult-val" id="upgMultVal">1.92×</div></div>'
        + '<div class="upg-handle" id="upgHandle"></div>'
        + '</div>'
        + '<p class="upg-hint">Drag the gold handle to set your win chance.</p>'
        + betControlsHTML(10)
        + '<div class="game-msg info" id="upMsg">Set your chance and bet, then spin.</div>'
        + '<div class="game-actions"><button type="button" class="btn btn-primary" id="upPlay">Spin</button></div>';

      var betInput = wireBetControls();
      var msg = document.getElementById('upMsg');
      var stageEl = document.getElementById('upgStage');
      var ring = document.getElementById('upgRing');
      var needle = document.getElementById('upgNeedle');
      var handle = document.getElementById('upgHandle');
      var chanceValEl = document.getElementById('upgChanceVal');
      var multValEl = document.getElementById('upgMultVal');
      var playBtn = document.getElementById('upPlay');

      var CENTER = 130, RADIUS = 114;

      function multiplierFor(c){ return (1 - HOUSE_EDGE) / c; }

      function render(){
        var deg = chance * 360;
        ring.style.background = 'conic-gradient(from 0deg, #22D3B6 0deg, #22D3B6 ' + deg + 'deg, #E23A54 ' + deg + 'deg, #E23A54 360deg)';
        var angleRad = (deg - 90) * Math.PI / 180;
        handle.style.left = (CENTER + RADIUS * Math.cos(angleRad)) + 'px';
        handle.style.top = (CENTER + RADIUS * Math.sin(angleRad)) + 'px';
        chanceValEl.textContent = (chance * 100).toFixed(1) + '%';
        multValEl.textContent = multiplierFor(chance).toFixed(2) + '×';
      }
      render();

      function pointerPos(e){
        if(e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        return { x: e.clientX, y: e.clientY };
      }
      function angleFromClient(x, y){
        var rect = stageEl.getBoundingClientRect();
        var dx = x - (rect.left + rect.width / 2);
        var dy = y - (rect.top + rect.height / 2);
        return (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
      }
      function onDragMove(e){
        if(!dragging) return;
        e.preventDefault();
        var p = pointerPos(e);
        var c = angleFromClient(p.x, p.y) / 360;
        chance = Math.max(MIN_CHANCE, Math.min(MAX_CHANCE, c));
        render();
      }
      function onDragEnd(){
        dragging = false;
        stageEl.classList.remove('dragging');
        document.removeEventListener('pointermove', onDragMove);
        document.removeEventListener('pointerup', onDragEnd);
      }
      function onDragStart(e){
        if(playBtn.disabled) return;
        dragging = true;
        stageEl.classList.add('dragging');
        onDragMove(e);
        document.addEventListener('pointermove', onDragMove);
        document.addEventListener('pointerup', onDragEnd);
      }
      stageEl.addEventListener('pointerdown', onDragStart);

      playBtn.addEventListener('click', function(){
        var bet = currentBet(betInput);
        playBtn.disabled = true;
        setRoundLocked(true);
        showMsg(msg, 'Spinning…', 'info');
        Api.post('/api/games/upgrader', { bet: bet, chance: chance }).then(function(res){
          var currentMod = ((needleRotation % 360) + 360) % 360;
          var delta = ((res.landingAngle - currentMod) % 360 + 360) % 360;
          needleRotation = needleRotation + delta + 5 * 360;
          needle.style.transform = 'rotate(' + needleRotation + 'deg)';
          setTimeout(function(){
            applyWallet(res.wallet);
            syncGmBalance();
            showMsg(msg, res.won ? ('Success! +' + fmt(res.payout - bet)) : ('Failed -' + fmt(bet)), res.won ? 'win' : 'lose');
            playBtn.disabled = false;
            setRoundLocked(false);
          }, 3300);
        }).catch(function(err){
          setRoundLocked(false);
          showMsg(msg, err.message, 'lose');
          playBtn.disabled = false;
        });
      });
    }
  };

  Games.casebattles = {
    mount: function(stage){
      var table = [0.10, 0.25, 0.50, 1.00, 2.00, 5.00, 10.00];
      var rarityFor = function(v){
        if(v >= 5) return 'r-legendary';
        if(v >= 2) return 'r-rare';
        if(v >= 0.5) return 'r-uncommon';
        return 'r-common';
      };
      function itemHtml(v){
        return '<div class="case-item ' + rarityFor(v) + '" data-val="' + v + '"><span class="rarity-dot"></span>' + v + '×</div>';
      }
      var itemsHtml = table.map(itemHtml).join('');
      var REPEATS = 8;
      var reelHtml = '';
      for(var r = 0; r < REPEATS; r++) reelHtml += itemsHtml;

      stage.innerHTML =
        '<div class="case-reel-wrap"><div class="case-pointer-cap"></div><div class="case-reel" id="cbReel">' + reelHtml + '</div></div>'
        + betControlsHTML(10)
        + '<div class="game-msg info" id="cbMsg">Set your case price and open.</div>'
        + '<div class="game-actions"><button type="button" class="btn btn-primary" id="cbPlay">Open Case</button></div>';

      var betInput = wireBetControls();
      var msg = document.getElementById('cbMsg');
      var wrap = stage.querySelector('.case-reel-wrap');
      var reel = document.getElementById('cbReel');

      var playBtn = document.getElementById('cbPlay');

      playBtn.addEventListener('click', function(){
        var bet = currentBet(betInput);
        playBtn.disabled = true;
        setRoundLocked(true);
        showMsg(msg, 'Opening…', 'info');
        reel.querySelectorAll('.case-item.landed').forEach(function(el){ el.classList.remove('landed'); });

        Api.post('/api/games/casebattles', { bet: bet }).then(function(res){
          var items = reel.querySelectorAll('.case-item');
          // land somewhere in one of the later repeats (not the very first pass) so the spin has distance to travel
          var candidateIdx = [];
          items.forEach(function(el, i){
            if(i >= table.length * 4 && i < table.length * 7 && parseFloat(el.dataset.val) === res.multiplier){
              candidateIdx.push(i);
            }
          });
          var targetIndex = candidateIdx.length
            ? candidateIdx[Math.floor(Math.random() * candidateIdx.length)]
            : table.length * 5 + table.indexOf(res.multiplier);
          var targetItem = items[targetIndex];

          var wrapWidth = wrap.offsetWidth;
          var itemCenter = targetItem.offsetLeft + targetItem.offsetWidth / 2;
          var translateX = (wrapWidth / 2) - itemCenter;

          reel.style.transition = 'none';
          reel.style.transform = 'translateX(0px)';
          void reel.offsetWidth;
          reel.style.transition = 'transform 5.5s cubic-bezier(.09,.68,.14,1)';
          reel.style.transform = 'translateX(' + translateX + 'px)';

          setTimeout(function(){
            targetItem.classList.add('landed');
            applyWallet(res.wallet);
            syncGmBalance();
            var net = res.payout - bet;
            showMsg(msg, 'Landed ' + res.multiplier + '× — ' + (net >= 0 ? '+' : '') + fmt(net), net >= 0 ? 'win' : 'lose');
            playBtn.disabled = false;
            setRoundLocked(false);
          }, 5600);
        }).catch(function(err){
          setRoundLocked(false);
          showMsg(msg, err.message, 'lose');
          playBtn.disabled = false;
        });
      });
    }
  };

  Games.mines = {
    mount: function(stage){
      stage.innerHTML =
        betControlsHTML(10)
        + '<div class="bet-row"><select id="mnCount" style="flex:1; background:var(--bg); border:1px solid var(--border); border-radius:9px; padding:11px; color:var(--text-1); font-family:var(--f-mono); font-size:13px;">'
        + [1, 3, 5, 10, 15, 20].map(function(n){ return '<option value="' + n + '"' + (n === 3 ? ' selected' : '') + '>' + n + ' mines</option>'; }).join('')
        + '</select></div>'
        + '<div class="mines-status"><span>Multiplier: <b id="mnMult">1.00×</b></span><span id="mnPotential">Cash out: 0.00</span></div>'
        + '<div class="mines-grid" id="mnGrid"></div>'
        + '<div class="game-msg info" id="mnMsg">Pick a bet and mine count, then start.</div>'
        + '<div class="game-actions"><button type="button" class="btn btn-primary" id="mnStart">Start</button><button type="button" class="btn btn-gold" id="mnCashout" style="display:none;">Cash Out</button></div>';

      var betInput = wireBetControls();
      var countSel = document.getElementById('mnCount');
      var msg = document.getElementById('mnMsg');
      var gridEl = document.getElementById('mnGrid');
      var multEl = document.getElementById('mnMult');
      var potEl = document.getElementById('mnPotential');
      var startBtn = document.getElementById('mnStart');
      var cashoutBtn = document.getElementById('mnCashout');
      var active = false;
      var currentBetAmt = 0;

      function buildGrid(enabled){
        gridEl.innerHTML = '';
        for(var i = 0; i < 25; i++){
          var tile = document.createElement('button');
          tile.type = 'button';
          tile.className = 'mines-tile';
          tile.dataset.index = i;
          tile.disabled = !enabled;
          tile.addEventListener('click', onTileClick);
          gridEl.appendChild(tile);
        }
      }
      buildGrid(false);

      function onTileClick(e){
        if(!active) return;
        var tile = e.currentTarget;
        if(tile.disabled) return;
        var index = parseInt(tile.dataset.index, 10);
        tile.disabled = true;
        Api.post('/api/games/mines/reveal', { tile: index }).then(function(res){
          if(res.safe){
            tile.classList.add('gem');
            tile.textContent = '💎';
            multEl.textContent = res.multiplier.toFixed(2) + '×';
            potEl.textContent = 'Cash out: ' + fmt(res.potentialPayout);
            cashoutBtn.style.display = '';
            showMsg(msg, 'Safe! Keep going or cash out.', 'win');
          } else {
            active = false;
            res.mineIndices.forEach(function(mi){
              var t = gridEl.querySelector('[data-index="' + mi + '"]');
              if(t){ t.classList.add('mine'); t.textContent = '💣'; }
            });
            gridEl.querySelectorAll('.mines-tile').forEach(function(t){ t.disabled = true; });
            cashoutBtn.style.display = 'none';
            startBtn.style.display = '';
            applyWallet(res.wallet);
            syncGmBalance();
            showMsg(msg, 'Boom — you lost ' + fmt(currentBetAmt) + '.', 'lose');
            setRoundLocked(false);
          }
        }).catch(function(err){
          showMsg(msg, err.message, 'lose');
        });
      }

      startBtn.addEventListener('click', function(){
        var bet = currentBet(betInput);
        var mineCount = parseInt(countSel.value, 10);
        startBtn.disabled = true;
        Api.post('/api/games/mines/start', { bet: bet, mineCount: mineCount }).then(function(res){
          currentBetAmt = bet;
          active = true;
          setRoundLocked(true);
          if(App.user){ App.user.balance = res.balance; renderUser(); }
          syncGmBalance();
          buildGrid(true);
          multEl.textContent = '1.00×';
          potEl.textContent = 'Cash out: 0.00';
          startBtn.style.display = 'none';
          showMsg(msg, 'Round started — pick a tile.', 'info');
          startBtn.disabled = false;
        }).catch(function(err){
          showMsg(msg, err.message, 'lose');
          startBtn.disabled = false;
        });
      });

      cashoutBtn.addEventListener('click', function(){
        cashoutBtn.disabled = true;
        Api.post('/api/games/mines/cashout').then(function(res){
          active = false;
          gridEl.querySelectorAll('.mines-tile').forEach(function(t){ t.disabled = true; });
          cashoutBtn.style.display = 'none';
          startBtn.style.display = '';
          applyWallet(res.wallet);
          syncGmBalance();
          showMsg(msg, 'Cashed out +' + fmt(res.payout - currentBetAmt) + '.', 'win');
          cashoutBtn.disabled = false;
          setRoundLocked(false);
        }).catch(function(err){
          showMsg(msg, err.message, 'lose');
          cashoutBtn.disabled = false;
        });
      });
    }
  };

  Games.crash = {
    mount: function(stage){
      stage.innerHTML =
        '<div class="crash-display" id="crDisplay">'
        + '<canvas id="crCanvas"></canvas>'
        + '<div class="crash-live-badge" id="crLiveBadge" style="display:none;"><span class="dot"></span>LIVE</div>'
        + '<div class="crash-mult-overlay"><div class="crash-mult" id="crMult">1.00×</div><div class="crash-sub" id="crSub">Place a bet to start</div></div>'
        + '</div>'
        + betControlsHTML(10)
        + '<div class="game-msg info" id="crMsg">Place your bet before the round starts.</div>'
        + '<div class="game-actions"><button type="button" class="btn btn-primary" id="crBet">Place Bet</button><button type="button" class="btn btn-gold" id="crCashout" style="display:none;">Cash Out</button></div>';

      var betInput = wireBetControls();
      var msg = document.getElementById('crMsg');
      var display = document.getElementById('crDisplay');
      var canvas = document.getElementById('crCanvas');
      var ctx = canvas.getContext('2d');
      var multEl = document.getElementById('crMult');
      var subEl = document.getElementById('crSub');
      var betBtn = document.getElementById('crBet');
      var cashoutBtn = document.getElementById('crCashout');
      var liveBadge = document.getElementById('crLiveBadge');
      var pollTimer = null;
      var rafId = null;
      var currentBetAmt = 0;

      var GROWTH_PER_SEC = 0.09; // mirrors games/crash.js — purely for the smooth visual curve
      var startTime = null;
      var points = [];
      var running = false;
      var crashedState = false;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);

      function resizeCanvas(){
        var w = display.clientWidth, h = display.clientHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      resizeCanvas();

      function stopPolling(){ if(pollTimer){ clearInterval(pollTimer); pollTimer = null; } }
      function stopRaf(){ if(rafId){ cancelAnimationFrame(rafId); rafId = null; } }
      currentGameCleanup = function(){ stopPolling(); stopRaf(); };

      function draw(){
        var w = display.clientWidth, h = display.clientHeight;
        ctx.clearRect(0, 0, w, h);
        if(points.length < 2) return;

        var padLeft = 54, padRight = 64, padTop = 16, padBottom = 16;
        var last = points[points.length - 1];
        var maxT = Math.max(last.t, 500);
        var maxM = Math.max(1.4, last.m * 1.18);
        function X(t){ return padLeft + (t / maxT) * (w - padLeft - padRight); }
        function Y(m){ return h - padBottom - ((m - 1) / (maxM - 1)) * (h - padTop - padBottom); }

        var lineColor = crashedState ? '#FF2E4D' : '#22D3B6';
        var fillTop = crashedState ? 'rgba(255,46,77,0.28)' : 'rgba(34,211,182,0.28)';

        // Y-axis gridlines with real multiplier values — this is what
        // makes it read as a chart instead of just a squiggly line.
        ctx.strokeStyle = 'rgba(128,128,150,0.12)';
        ctx.fillStyle = 'rgba(180,184,200,0.55)';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1;
        var steps = 5;
        for(var i = 0; i <= steps; i++){
          var val = 1 + ((maxM - 1) * i / steps);
          var gy = Math.round(Y(val)) + 0.5;
          ctx.beginPath(); ctx.moveTo(padLeft, gy); ctx.lineTo(w - padRight, gy); ctx.stroke();
          ctx.fillText(val.toFixed(2) + '×', padLeft - 8, gy);
        }

        // area under the curve
        var grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, fillTop);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.moveTo(X(points[0].t), h - padBottom);
        points.forEach(function(p){ ctx.lineTo(X(p.t), Y(p.m)); });
        ctx.lineTo(X(last.t), h - padBottom);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // the line itself
        ctx.beginPath();
        points.forEach(function(p, i){
          var x = X(p.t), y = Y(p.m);
          if(i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = lineColor;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // rocket / explosion glyph riding the tip of the curve
        var tipX = X(last.t), tipY = Y(last.m);
        var refIdx = Math.max(0, points.length - 5);
        var ref = points[refIdx];
        var dx = tipX - X(ref.t), dy = tipY - Y(ref.m);
        var angle = Math.atan2(dy, dx);

        ctx.save();
        ctx.translate(tipX, tipY);
        if(!crashedState){
          ctx.rotate(angle + Math.PI / 2);
        }
        ctx.font = crashedState ? '30px sans-serif' : '22px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(crashedState ? '💥' : '🚀', 0, 0);
        ctx.restore();

        // live "last price" tag pinned to the right edge, trading-terminal style
        var tagY = Math.min(Math.max(tipY, padTop + 10), h - padBottom - 10);
        var tagText = last.m.toFixed(2) + '×';
        ctx.font = '600 12px "JetBrains Mono", monospace';
        var tagWidth = ctx.measureText(tagText).width + 16;
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        var tagX = w - padRight + 8;
        var tagH = 20;
        if(ctx.roundRect){
          ctx.roundRect(tagX, tagY - tagH / 2, tagWidth, tagH, 4);
        } else {
          ctx.rect(tagX, tagY - tagH / 2, tagWidth, tagH);
        }
        ctx.fill();
        ctx.fillStyle = '#06120F';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, tagX + 8, tagY + 1);

        // dashed guide line from the curve tip to the price tag
        ctx.strokeStyle = lineColor;
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tagX, tagY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      function tick(){
        if(!running) return;
        var elapsed = performance.now() - startTime;
        var m = Math.exp(GROWTH_PER_SEC * (elapsed / 1000));
        points.push({ t: elapsed, m: m });
        if(points.length > 400) points.shift();
        multEl.textContent = m.toFixed(2) + '×';
        draw();
        rafId = requestAnimationFrame(tick);
      }

      function pollState(){
        Api.get('/api/games/crash/state').then(function(res){
          if(res.active){
            // authoritative multiplier — keep our visual curve honest if it drifts
          } else if(res.crashed){
            stopPolling();
            running = false;
            stopRaf();
            crashedState = true;
            points.push({ t: (performance.now() - startTime), m: res.crashPoint });
            draw();
            display.classList.remove('shake');
            void display.offsetWidth;
            display.classList.add('shake');
            multEl.textContent = res.crashPoint.toFixed(2) + '×';
            multEl.classList.add('crashed');
            subEl.textContent = 'Crashed!';
            cashoutBtn.style.display = 'none';
            liveBadge.style.display = 'none';
            betBtn.style.display = '';
            applyWallet(res.wallet);
            syncGmBalance();
            showMsg(msg, 'Crashed at ' + res.crashPoint.toFixed(2) + '× — you lost ' + fmt(currentBetAmt) + '.', 'lose');
            setRoundLocked(false);
          } else {
            stopPolling();
          }
        }).catch(function(){ stopPolling(); });
      }

      betBtn.addEventListener('click', function(){
        var bet = currentBet(betInput);
        betBtn.disabled = true;
        Api.post('/api/games/crash/bet', { bet: bet }).then(function(res){
          currentBetAmt = bet;
          setRoundLocked(true);
          if(App.user){ App.user.balance = res.balance; renderUser(); }
          syncGmBalance();
          betBtn.style.display = 'none';
          cashoutBtn.style.display = '';
          liveBadge.style.display = 'flex';
          multEl.classList.remove('crashed');
          multEl.textContent = '1.00×';
          subEl.textContent = 'Round in progress…';
          showMsg(msg, 'Climbing…', 'info');

          resizeCanvas();
          points = [{ t: 0, m: 1 }];
          crashedState = false;
          running = true;
          startTime = performance.now();
          stopRaf();
          rafId = requestAnimationFrame(tick);
          stopPolling();
          pollTimer = setInterval(pollState, 150);
          betBtn.disabled = false;
        }).catch(function(err){
          showMsg(msg, err.message, 'lose');
          betBtn.disabled = false;
        });
      });

      cashoutBtn.addEventListener('click', function(){
        stopPolling();
        running = false;
        stopRaf();
        cashoutBtn.disabled = true;
        Api.post('/api/games/crash/cashout').then(function(res){
          if(res.crashed){
            crashedState = true;
            points.push({ t: (performance.now() - startTime), m: res.crashPoint });
            draw();
            display.classList.remove('shake');
            void display.offsetWidth;
            display.classList.add('shake');
            multEl.textContent = res.crashPoint.toFixed(2) + '×';
            multEl.classList.add('crashed');
            subEl.textContent = 'Crashed just before you cashed out!';
            showMsg(msg, 'Too slow — crashed at ' + res.crashPoint.toFixed(2) + '×.', 'lose');
          } else {
            points.push({ t: (performance.now() - startTime), m: res.cashedOutAt });
            draw();
            subEl.textContent = 'Cashed out!';
            showMsg(msg, 'Cashed out at ' + res.cashedOutAt.toFixed(2) + '× — +' + fmt(res.payout - currentBetAmt) + '.', 'win');
          }
          cashoutBtn.style.display = 'none';
          liveBadge.style.display = 'none';
          betBtn.style.display = '';
          applyWallet(res.wallet);
          syncGmBalance();
          cashoutBtn.disabled = false;
          setRoundLocked(false);
        }).catch(function(err){
          showMsg(msg, err.message, 'lose');
          cashoutBtn.disabled = false;
        });
      });
    }
  };

  Games.blackjack = {
    mount: function(stage){
      stage.innerHTML =
        '<div class="bj-table"><div class="bj-hands">'
        + '<div><div class="bj-hand-label"><span>Dealer</span><span id="bjDealerTotal"></span></div><div class="bj-cards" id="bjDealerCards"></div></div>'
        + '<div><div class="bj-hand-label"><span>You</span><span id="bjPlayerTotal"></span></div><div class="bj-cards" id="bjPlayerCards"></div></div>'
        + '</div></div>'
        + betControlsHTML(10)
        + '<div class="game-msg info" id="bjMsg">Place your bet and deal.</div>'
        + '<div class="game-actions" id="bjActions">'
        + '<button type="button" class="btn btn-primary" id="bjDeal">Deal</button>'
        + '<button type="button" class="btn btn-ghost" id="bjHit" style="display:none;">Hit</button>'
        + '<button type="button" class="btn btn-gold" id="bjStand" style="display:none;">Stand</button>'
        + '</div>';

      var betInput = wireBetControls();
      var msg = document.getElementById('bjMsg');
      var dealerCardsEl = document.getElementById('bjDealerCards');
      var playerCardsEl = document.getElementById('bjPlayerCards');
      var dealerTotalEl = document.getElementById('bjDealerTotal');
      var playerTotalEl = document.getElementById('bjPlayerTotal');
      var dealBtn = document.getElementById('bjDeal');
      var hitBtn = document.getElementById('bjHit');
      var standBtn = document.getElementById('bjStand');
      var currentBetAmt = 0;

      function cardHtml(card, hidden){
        if(hidden){
          return '<div class="bj-card hidden"><div class="bj-card-back"><svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg></div></div>';
        }
        var rank = card.slice(0, -1), suit = card.slice(-1);
        var suitChar = { S: '♠', H: '♥', D: '♦', C: '♣' }[suit];
        var isRed = suit === 'H' || suit === 'D';
        var corner = '<b>' + rank + '</b>' + suitChar;
        return '<div class="bj-card' + (isRed ? ' red-suit' : '') + '">'
          + '<span class="bj-card-corner bj-card-corner-tl">' + corner + '</span>'
          + '<span class="bj-card-suit-center">' + suitChar + '</span>'
          + '<span class="bj-card-corner bj-card-corner-br">' + corner + '</span>'
          + '</div>';
      }
      function clientHandValue(hand){
        var total = 0, aces = 0;
        hand.forEach(function(c){
          var rank = c.slice(0, -1);
          var v = rank === 'A' ? 11 : (['J', 'Q', 'K'].indexOf(rank) > -1 ? 10 : parseInt(rank, 10));
          if(rank === 'A') aces++;
          total += v;
        });
        while(total > 21 && aces > 0){ total -= 10; aces--; }
        return total;
      }
      function renderHands(playerHand, dealerHand, dealerHidden){
        playerCardsEl.innerHTML = playerHand.map(function(c){ return cardHtml(c, false); }).join('');
        var dealerHtml = dealerHand.map(function(c){ return cardHtml(c, false); }).join('');
        if(dealerHidden) dealerHtml += cardHtml(null, true);
        dealerCardsEl.innerHTML = dealerHtml;
        playerTotalEl.textContent = clientHandValue(playerHand);
        dealerTotalEl.textContent = dealerHidden ? '' : clientHandValue(dealerHand);
      }
      function resetControls(){
        dealBtn.style.display = '';
        hitBtn.style.display = 'none';
        standBtn.style.display = 'none';
      }

      dealBtn.addEventListener('click', function(){
        var bet = currentBet(betInput);
        dealBtn.disabled = true;
        Api.post('/api/games/blackjack/deal', { bet: bet }).then(function(res){
          currentBetAmt = bet;
          if(res.finished){
            renderHands(res.playerHand, res.dealerHand, false);
            applyWallet(res.wallet);
            syncGmBalance();
            var net = res.payout - bet;
            showMsg(msg, res.outcome === 'push' ? 'Push — bet returned.' : ('Blackjack! +' + fmt(net)), res.outcome === 'push' ? 'info' : 'win');
            resetControls();
          } else {
            setRoundLocked(true);
            renderHands(res.playerHand, res.dealerHand, true);
            if(App.user){ App.user.balance -= 0; }
            refreshMe().then(function(){ syncGmBalance(); });
            dealBtn.style.display = 'none';
            hitBtn.style.display = '';
            standBtn.style.display = '';
            showMsg(msg, 'Hit or stand.', 'info');
          }
          dealBtn.disabled = false;
        }).catch(function(err){
          showMsg(msg, err.message, 'lose');
          dealBtn.disabled = false;
        });
      });

      hitBtn.addEventListener('click', function(){
        hitBtn.disabled = true;
        Api.post('/api/games/blackjack/hit').then(function(res){
          if(res.finished){
            renderHands(res.playerHand, [], false);
            applyWallet(res.wallet);
            syncGmBalance();
            showMsg(msg, 'Bust — you lost ' + fmt(currentBetAmt) + '.', 'lose');
            resetControls();
            setRoundLocked(false);
          } else {
            playerCardsEl.innerHTML = res.playerHand.map(function(c){ return cardHtml(c, false); }).join('');
            playerTotalEl.textContent = res.total;
          }
          hitBtn.disabled = false;
        }).catch(function(err){
          showMsg(msg, err.message, 'lose');
          hitBtn.disabled = false;
        });
      });

      standBtn.addEventListener('click', function(){
        standBtn.disabled = true;
        Api.post('/api/games/blackjack/stand').then(function(res){
          renderHands(res.playerHand, res.dealerHand, false);
          applyWallet(res.wallet);
          syncGmBalance();
          var net = res.payout - currentBetAmt;
          var label = res.outcome === 'win' ? ('You win! +' + fmt(net)) : (res.outcome === 'push' ? 'Push — bet returned.' : ('Dealer wins -' + fmt(currentBetAmt)));
          showMsg(msg, label, res.outcome === 'win' ? 'win' : (res.outcome === 'push' ? 'info' : 'lose'));
          resetControls();
          standBtn.disabled = false;
          setRoundLocked(false);
        }).catch(function(err){
          showMsg(msg, err.message, 'lose');
          standBtn.disabled = false;
        });
      });
    }
  };

  // Called by each game's own page (e.g. games/coinflip.html) to mount
  // that game directly into the page instead of a modal.
  function mountGamePage(key){
    var container = document.getElementById('gamePageStage');
    var gate = document.getElementById('gameSignInGate');
    if(!container) return;
    var titleEl = document.getElementById('gmTitle');
    var subEl = document.getElementById('gmSub');
    if(titleEl) titleEl.textContent = GAME_META[key].title;
    if(subEl) subEl.textContent = GAME_META[key].sub;

    function doMount(){
      if(gate) gate.style.display = 'none';
      container.style.display = 'block';
      currentGameCleanup = null;
      setRoundLocked(false);
      syncGmBalance();
      Games[key].mount(container);
    }

    // Wait for the initial /api/me check before deciding what to show —
    // otherwise a logged-in user briefly sees the sign-in gate flash by
    // on every page load while that request is still in flight.
    (window.appReady || Promise.resolve()).then(function(){
      if(App.user){ doMount(); return; }
      if(gate) gate.style.display = 'flex';
      container.style.display = 'none';
      requireLogin();
      var check = setInterval(function(){
        if(App.user){ clearInterval(check); doMount(); }
      }, 400);
    });
  }
  window.mountGamePage = mountGamePage;
  window.requireLogin = requireLogin;
  window.loadRecentActivity = loadRecentActivity;

  /* ================= init ================= */
  window.appReady = refreshMe().then(function(){
    if(App.user) loadChat();
  });
  setInterval(function(){ if(App.user) loadChat(); }, 4000);

})();
