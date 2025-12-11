/* =========================================================
   Optimized script.js for AMS2 Racing League - v5.2
   - Uses existing Firebase wrappers on window (ref/get/push/onValue/set)
   - Profiles keyed by username (Driver_Profiles/{username})
   - Season-aware leaderboard + round navigation
   - Caching for static data
   - Cleaner helpers & faster DOM updates
   - FIXED: Form reset, rounds completed logic, placeholder images
   - FIXED: Per-season calculations, tab visibility, descending sort
   - FIXED: Pre-select latest season WITH lap submissions only
   - FIXED: Show initials and number badge when logged out (all sections, mobile-friendly)
   - FIXED: Chart respects login status (no photos when logged out)
   - FIXED: Chart mobile-responsive with proper aspect ratio
   - FIXED: Chart starts at R0 with 0 points for all drivers
   - FIXED: Avatar animation draws avatars at line tip (no pre-drawn lines)
   - FIXED: Infinite loop crash prevented with proper animation flag
   - NEW: Animated points progression graph with racing driver avatars
   - NEW: Intersection Observer - chart animates only when scrolled into view
   - NEW: Y-axis dynamically scales as data appears (zoom-out effect)
   - NEW: Race animation showing top 3 cars racing through sectors
   - NEW: Smooth race animation with finish line carpets (gold/silver/bronze)
   - NEW: Admin Tools for lap time management (edit/delete)
   ========================================================= */

/* -----------------------------
   Helpers & Cached State
   ----------------------------- */
const CACHE = {
  tracksMap: null,
  carsMap: null,
  setupArray: null,
  roundDataArray: null,
  leaderboardArray: null
};

function toArray(obj) {
  if (!obj) return [];
  return Array.isArray(obj) ? obj : Object.values(obj);
}

function normalizePhotoUrl(url) {
  if (!url) return '';
  if (url.includes('drive.google.com/uc?id=')) {
    const fileId = url.split('id=')[1];
    return `https://lh3.googleusercontent.com/d/${fileId}=s200`;
  }
  return url;
}

function safeGet(fn, fallback = '') {
  try { return fn(); } catch { return fallback; }
}

// format seconds into MM:SS,mmm safe with non-numeric values
function formatTime(seconds) {
  if (seconds === undefined || seconds === null || seconds === '') return '';
  const totalSeconds = parseFloat(seconds);
  if (!isFinite(totalSeconds)) return '';
  const minutes = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const milliseconds = Math.round((totalSeconds % 1) * 1000);

  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const ms = String(milliseconds).padStart(3, '0');

  return `${mm}:${ss},${ms}`;
}

function timeToSeconds(timeStr) {
  if (!timeStr) return 0;
  // Expect MM:SS,mmm
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return parseFloat(timeStr) || 0;
  const minutes = parseInt(parts[0]) || 0;
  const secondsParts = parts[1].split(',');
  const seconds = parseInt(secondsParts[0]) || 0;
  const milliseconds = parseInt(secondsParts[1]) || 0;
  return minutes * 60 + seconds + milliseconds / 1000;
}

function encodeKey(name) {
  // safe firebase key from username: replace '.' and '/' with '_' etc.
  return String(name).replace(/[.#$\[\]/]/g, '_');
}

/* -----------------------------
   Global app state
   ----------------------------- */
let ALLOWED_USERS = {};      // { username: { email, password } } - email may be empty in your config
let DRIVER_PROFILES = {};    // { usernameKey: { name, surname, number, photoUrl, bio } }
let DRIVER_PROFILE_INDICES = {}; // { usernameKey: arrayIndex } - for array-based storage
let APPS_SCRIPT_URL = null;
let currentUser = null;      // { name: username, email? }

// Admin filter state
let currentAdminFilters = {
  driver: '',
  season: '',
  round: ''
};

let adminSortAscending = true;
let currentAdminTab = 'time-submissions';

/* -----------------------------
   Config & initial listeners
   ----------------------------- */
async function loadConfig() {
  try {
    const configRef = window.firebaseRef(window.firebaseDB, 'Config');
    // Use onValue to keep ALLOWED_USERS updated live
    window.firebaseOnValue(configRef, (snapshot) => {
      const configData = snapshot.val();
      if (!configData) return;

      const cfgArr = toArray(configData);
      const configMap = {};
      cfgArr.forEach(row => {
        const setting = row['Setting']?.trim();
        const value = row['Value']?.trim();
        if (setting && (value !== undefined)) configMap[setting] = value;
      });

      APPS_SCRIPT_URL = configMap['apps_script_url'];

      // Set admin username
      updateAdminUsername(configMap);

      // Build ALLOWED_USERS from config allowed_name_i, allowed_email_i, allowed_password_i
      const allowed = {};
      for (let i = 1; i <= 20; i++) {
        const name = configMap[`allowed_name_${i}`];
        const email = configMap[`allowed_email_${i}`];
        const password = configMap[`allowed_password_${i}`];
        if (name && password) {
          allowed[name] = { email: email || '', password };
        }
      }
      ALLOWED_USERS = allowed;
      console.log('Config loaded. Users:', Object.keys(ALLOWED_USERS).length);
    });

    // Load driver profiles (object keyed by username if available)
    // We'll use onValue so profile edits are reflected live
const profilesRef = window.firebaseRef(window.firebaseDB, 'Driver_Profiles');
window.firebaseOnValue(profilesRef, (snapshot) => {
    const profilesData = snapshot.val();
    if (!profilesData) return;

    DRIVER_PROFILES = {};
    DRIVER_PROFILE_INDICES = {}; // Also track array indices
    
    profilesData.forEach((profile, index) => {
        const email = profile['Email']?.trim();
        if (email) {
            const usernameKey = encodeKey(profile['Name']?.trim() || '');
            
            DRIVER_PROFILES[email] = {
                name: profile['Name']?.trim() || '',
                surname: profile['Surname']?.trim() || '',
                number: profile['Number']?.toString() || '',
                photoUrl: profile['Photo_URL']?.trim() || '',
                bio: profile['Bio']?.trim() || '',
                equipment: profile['equipment'] || {}  // ✅ INCLUDE EQUIPMENT
            };
            
            // Also store by username key for easy lookup
            DRIVER_PROFILES[usernameKey] = DRIVER_PROFILES[email];
            
            // Track array index for saving
            DRIVER_PROFILE_INDICES[usernameKey] = index;
        }
    });

    console.log('Driver profiles loaded from Firebase:', Object.keys(DRIVER_PROFILES).length);
});

  } catch (err) {
    console.error('loadConfig error', err);
  }
}

/* -----------------------------
   UI: Tabs & Navigation
   ----------------------------- */
function safeAddActiveButton(target) {
  // highlight clicked button - fallback when event not available
  if (!target) {
    // try to infer from active tab
    const activeTabName = document.querySelector('.tab-content.active')?.id;
    const btn = document.querySelector(`.tab-button[onclick*="${activeTabName}"]`);
    if (btn) btn.classList.add('active');
    return;
  }
  target.classList.add('active');
}

function showTab(tabName, sourceButton = null) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));

  const tabEl = document.getElementById(tabName);
  if (!tabEl) return;
  tabEl.classList.add('active');

  safeAddActiveButton(sourceButton || document.activeElement);

  // Tab-specific loads
  if (tabName === 'overall') {
    loadLeaderboard();
  } else if (tabName === 'round') {
    preSelectCurrentSeasonInRoundResults();
    loadRoundData();
  } else if (tabName === 'drivers') {
    loadDriverStats();
  } else if (tabName === 'profile') {
    loadProfile();
  } else if (tabName === 'setup') {
    loadRoundSetup();
  } else if (tabName === 'admin') {
    loadAdminTools();
  }
}

// FIXED: Helper to pre-select current season when opening Round Results
async function preSelectCurrentSeasonInRoundResults() {
  const roundDropdown = document.getElementById('roundSeasonSelect');
  if (!roundDropdown) return;
  
  // If roundDropdown already has a value, keep it (user may have set it)
  if (roundDropdown.value) return;
  
  // Find the latest season that has actual lap submissions
  const rawLapsSnapshot = await window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Form_responses_1'));
  const rawLapsData = toArray(rawLapsSnapshot.val()).filter(r => r && r.Driver && r.Season && r.Round);
  
  if (rawLapsData.length === 0) {
    // No laps submitted yet, don't pre-select any season
    return;
  }
  
  // Get unique seasons from submitted laps and sort descending
  const seasonsWithLaps = [...new Set(rawLapsData.map(lap => lap.Season))].filter(s=>s).sort((a,b)=>b-a);
  const currentSeason = seasonsWithLaps[0] || '';
  
  if (currentSeason) roundDropdown.value = currentSeason;
}

/* goToDriverCurrentRound: uses season selected in Overall, or latest season with laps if "All Seasons" */
async function goToDriverCurrentRound(driverName) {
  showTab('round');

  let selectedSeason = document.getElementById('seasonSelect')?.value || '';
  
  // FIXED: If "All Seasons" selected, find the latest season with actual lap submissions
  if (!selectedSeason) {
    const rawLapsSnapshot = await window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Form_responses_1'));
    const rawLapsData = toArray(rawLapsSnapshot.val()).filter(r => r && r.Driver && r.Season && r.Round);
    
    if (rawLapsData.length > 0) {
      const seasonsWithLaps = [...new Set(rawLapsData.map(lap => lap.Season))].filter(s=>s).sort((a,b)=>b-a);
      selectedSeason = seasonsWithLaps[0] || ''; // Use latest season with laps
    } else {
      // Fallback to configured seasons if no laps yet
      if (!CACHE.setupArray) {
        const setupSnap = await window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Form_responses_2'));
        CACHE.setupArray = toArray(setupSnap.val());
      }
      const seasons = [...new Set(CACHE.setupArray.map(s => s.Season))].filter(s=>s).sort((a,b)=>b-a);
      selectedSeason = seasons[0] || '';
    }
  }
  
  const roundDropdown = document.getElementById('roundSeasonSelect');
  if (roundDropdown) roundDropdown.value = selectedSeason;

  // Wait a short moment for DOM, then loadRoundData ensures it uses roundSeasonSelect.value
  await wait(200);
  if (typeof loadRoundData === 'function') await loadRoundData();
  await wait(200);

  // Find round details for this season only
  const keyPrefix = selectedSeason ? `details-S${selectedSeason}-R` : 'details-S';
  const matches = Array.from(document.querySelectorAll(`[id^="${keyPrefix}"]`));
  if (!matches.length) {
    console.warn('No rounds for season', selectedSeason);
    return;
  }

  // Extract keys like "S3-R6" - with descending sort, first item is latest
  const keys = matches.map(el => el.id.replace('details-', ''));
  keys.sort((a,b) => {
    const [sa, ra] = a.replace('S','').split('-R').map(Number);
    const [sb, rb] = b.replace('S','').split('-R').map(Number);
    if (sa !== sb) return sb - sa; // Descending
    return rb - ra; // Descending
  });

  const latestKey = keys[0]; // First is now latest
  const details = document.getElementById(`details-${latestKey}`);
  const icon = document.getElementById(`toggle-${latestKey}`);
  if (!details) return;

  details.classList.add('expanded');
  if (icon) icon.classList.add('expanded');

  details.scrollIntoView({behavior: 'smooth', block: 'start'});
  details.style.transition = 'background 0.4s ease';
  details.style.background = '#fffa9c';
  setTimeout(()=> details.style.background = '', 700);
}

function goToDriverProfile(driverName) {
  showTab('drivers');
  setTimeout(() => {
    const card = document.querySelector(`.driver-card[data-driver="${driverName}"]`);
    if (card) {
      card.scrollIntoView({behavior: 'smooth', block: 'start'});
      const orig = card.style.background;
      card.style.background = '#fffa9c';
      setTimeout(()=> card.style.background = orig, 700);
    }
  }, 300);
}

function toggleRound(key) {
  const details = document.getElementById(`details-${key}`);
  const icon = document.getElementById(`toggle-${key}`);
  if (!details) return;
  details.classList.toggle('expanded');
  if (icon) icon.classList.toggle('expanded');
}

/* -----------------------------
   Points Progression Graph with Animated Driver Photos
   ----------------------------- */
let chartInstance = null; // Store chart instance globally
let chartAnimationTriggered = false; // Track if animation has run

function createPointsProgressionGraph(roundData, selectedSeason) {
  const graphContainer = document.getElementById('points-progression-graph');
  if (!graphContainer) return;

  // Destroy previous chart if it exists
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  chartAnimationTriggered = false;

  // Group data by driver and round to calculate cumulative points
  const driverRounds = {};
  const allRounds = new Set();

  roundData.forEach(row => {
    const driver = row.Driver;
    const round = parseInt(row.Round) || 0;
    const points = parseInt(row['Total_Points']) || 0;
    
    if (!driverRounds[driver]) driverRounds[driver] = {};
    if (!driverRounds[driver][round]) driverRounds[driver][round] = 0;
    driverRounds[driver][round] += points;
    allRounds.add(round);
  });

  const sortedRounds = Array.from(allRounds).sort((a,b) => a - b);
  if (sortedRounds.length === 0) {
    graphContainer.style.display = 'none';
    return;
  }

  // Calculate cumulative points for each driver at each round
  const datasets = [];
  const colors = ['#667eea', '#e74c3c', '#f39c12', '#2ecc71', '#9b59b6', '#1abc9c'];
  let colorIndex = 0;

  Object.keys(driverRounds).forEach(driver => {
    const cumulativePoints = [0]; // FIXED: Start with 0 points at R0
    let total = 0;

    sortedRounds.forEach(round => {
      total += (driverRounds[driver][round] || 0);
      cumulativePoints.push(total);
    });

    const profile = DRIVER_PROFILES[encodeKey(driver)] || {};
    const driverColor = colors[colorIndex % colors.length];
    colorIndex++;

    // FIXED: Only use photos if user is logged in
    const usePhoto = currentUser && profile.photoUrl;

    datasets.push({
      label: getFormattedDriverName(driver, false),
      data: cumulativePoints,
      borderColor: driverColor,
      backgroundColor: driverColor + '33',
      borderWidth: 0, // CHANGED: Hide Chart.js lines completely
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 0, // CHANGED: Also hide hover points
      driverName: driver,
      photoUrl: usePhoto ? normalizePhotoUrl(profile.photoUrl) : null,
      driverNumber: profile.number || '?'
    });
  });

  // Clear previous chart
  graphContainer.innerHTML = '<canvas id="pointsChart"></canvas>';
  const ctx = document.getElementById('pointsChart').getContext('2d');

  // Create the chart without any lines or animation
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['R0', ...sortedRounds.map(r => `R${r}`)], // FIXED: Add R0 label
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: window.innerWidth <= 768 ? 1.2 : 2.5, // Mobile-friendly aspect ratio
      animation: false, // Disable initial animation
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: window.innerWidth <= 480 ? 8 : 15,
            font: { 
              size: window.innerWidth <= 480 ? 10 : 12, 
              weight: 'bold' 
            }
          }
        },
        title: {
          display: true,
          text: selectedSeason ? `Season ${selectedSeason} Points Progression` : 'Overall Points Progression',
          font: { 
            size: window.innerWidth <= 480 ? 14 : 18, 
            weight: 'bold' 
          },
          padding: window.innerWidth <= 480 ? 10 : 20
        },
        tooltip: {
          enabled: false // CHANGED: Disable tooltips during animation
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: window.innerWidth > 480,
            text: 'Total Points',
            font: { size: 14, weight: 'bold' }
          },
          ticks: {
            stepSize: 5,
            font: { size: window.innerWidth <= 480 ? 10 : 12 }
          }
        },
        x: {
          title: {
            display: window.innerWidth > 480,
            text: 'Round',
            font: { size: 14, weight: 'bold' }
          },
          ticks: {
            font: { size: window.innerWidth <= 480 ? 10 : 12 }
          }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  });

  graphContainer.style.display = 'block';

  // FIXED: Use Intersection Observer to trigger animation only when visible
  setupChartVisibilityObserver(graphContainer, sortedRounds);
}

function setupChartVisibilityObserver(graphContainer, rounds) {
  // Remove any existing observer
  if (graphContainer._observer) {
    graphContainer._observer.disconnect();
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !chartAnimationTriggered) {
        chartAnimationTriggered = true;
        
        if (chartInstance) {
          // Start the animation
          animateDriverAvatars(chartInstance, rounds);
        }
        
        observer.disconnect();
      }
    });
  }, {
    threshold: 0.3,
    rootMargin: '0px'
  });

  observer.observe(graphContainer);
  graphContainer._observer = observer;
}

function animateDriverAvatars(chart, rounds) {
  const canvas = chart.canvas;
  const ctx = canvas.getContext('2d');
  const avatarSize = 30;
  const animationDuration = 2500;
  const startTime = Date.now();

  // Create avatar images
  const avatars = chart.data.datasets.map(dataset => {
    const img = new Image();
    if (dataset.photoUrl) {
      img.src = dataset.photoUrl;
    }
    return {
      img: img,
      loaded: false,
      driverNumber: dataset.driverNumber,
      color: dataset.borderColor,
      hasPhoto: !!dataset.photoUrl
    };
  });

  avatars.forEach((avatar, idx) => {
    if (avatar.hasPhoto) {
      avatar.img.onload = () => { avatar.loaded = true; };
      avatar.img.onerror = () => { avatar.hasPhoto = false; };
    }
  });

  function animate() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / animationDuration, 1);
    
    const currentPositionFloat = progress * rounds.length;
    const currentRoundIndex = Math.floor(currentPositionFloat);
    const roundProgress = currentPositionFloat - currentRoundIndex;

    // Redraw chart base (without lines)
    chart.update('none');

    // Draw our custom lines and avatars
    chart.data.datasets.forEach((dataset, idx) => {
      const avatar = avatars[idx];
      const meta = chart.getDatasetMeta(idx);
      if (!meta || !meta.data || meta.data.length === 0) return;

      ctx.save();
      
      // Draw the line up to current progress
      ctx.strokeStyle = dataset.borderColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      for (let i = 0; i <= currentRoundIndex; i++) {
        const point = meta.data[i];
        if (!point) continue;
        
        const x = point.x;
        const y = chart.scales.y.getPixelForValue(dataset.data[i]);
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      // Draw interpolated segment
      if (currentRoundIndex < meta.data.length - 1 && roundProgress > 0) {
        const currentPoint = meta.data[currentRoundIndex];
        const nextPoint = meta.data[currentRoundIndex + 1];
        
        if (currentPoint && nextPoint) {
          const currentY = chart.scales.y.getPixelForValue(dataset.data[currentRoundIndex]);
          const nextY = chart.scales.y.getPixelForValue(dataset.data[currentRoundIndex + 1]);
          
          const interpX = currentPoint.x + (nextPoint.x - currentPoint.x) * roundProgress;
          const interpY = currentY + (nextY - currentY) * roundProgress;
          
          ctx.lineTo(interpX, interpY);
        }
      }
      
      ctx.stroke();
      ctx.restore();

      // Draw avatar at tip
      const currentPoint = meta.data[currentRoundIndex];
      const nextPoint = meta.data[currentRoundIndex + 1];
      
      if (!currentPoint) return;

      let tipX, tipY;
      if (nextPoint && roundProgress > 0) {
        tipX = currentPoint.x + (nextPoint.x - currentPoint.x) * roundProgress;
        const currentY = chart.scales.y.getPixelForValue(dataset.data[currentRoundIndex]);
        const nextY = chart.scales.y.getPixelForValue(dataset.data[currentRoundIndex + 1]);
        tipY = currentY + (nextY - currentY) * roundProgress;
      } else {
        tipX = currentPoint.x;
        tipY = chart.scales.y.getPixelForValue(dataset.data[currentRoundIndex]);
      }

      ctx.save();
      
      if (avatar.hasPhoto && avatar.loaded) {
        ctx.beginPath();
        ctx.arc(tipX, tipY, avatarSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar.img, tipX - avatarSize / 2, tipY - avatarSize / 2, avatarSize, avatarSize);
        ctx.restore();
        
        ctx.save();
        ctx.strokeStyle = avatar.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(tipX, tipY, avatarSize / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(tipX, tipY, avatarSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = avatar.color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(avatar.driverNumber, tipX, tipY);
      }
      
      ctx.restore();
    });

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Animation complete - re-enable tooltips and restore full lines
      chart.options.plugins.tooltip.enabled = true;
      chart.data.datasets.forEach(dataset => {
        dataset.borderWidth = 3;
      });
      chart.update('none');
    }
  }

  requestAnimationFrame(animate);
}

/* -----------------------------
   Race Animation for Round Results
   ----------------------------- */
function createRaceAnimation(roundKey, results) {
  // Only show top 3
  const top3 = results.slice(0, 3);
  if (top3.length === 0) return '';

  const containerId = `race-animation-${roundKey}`;
  const canvasId = `race-canvas-${roundKey}`;
  const replayBtnId = `replay-${roundKey}`;

  // Create HTML structure
  const html = `
    <div class="race-animation-container" id="${containerId}">
      <div class="race-animation-header">
        <h4>🏁 Race Replay - Top 3</h4>
        <button class="replay-button" id="${replayBtnId}">↻ Replay</button>
      </div>
      <canvas id="${canvasId}" class="race-canvas"></canvas>
    </div>
  `;

  // Schedule animation setup after DOM insertion
  setTimeout(() => {
    setupRaceAnimation(canvasId, replayBtnId, top3, roundKey);
  }, 100);

  return html;
}

function setupRaceAnimation(canvasId, replayBtnId, top3, roundKey) {
  const canvas = document.getElementById(canvasId);
  const replayBtn = document.getElementById(replayBtnId);
  
  if (!canvas || !replayBtn) return;

  const ctx = canvas.getContext('2d');
  let animationId = null;
  let hasAnimated = false;
  let isAnimating = false;

  const resizeCanvas = () => {
    const container = canvas.parentElement;
    const rect = container.getBoundingClientRect();
    canvas.style.width = '100%';
    canvas.width = rect.width;
    canvas.height = canvas.offsetHeight;
    
    if (isAnimating) {
      cancelAnimationFrame(animationId);
      startAnimation();
    }
  };
  
  resizeCanvas();

  let resizeTimeout;
  const handleResize = () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      resizeCanvas();
    }, 100);
  };

  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', () => {
    setTimeout(resizeCanvas, 100);
  });

  const colors = ['#667eea', '#e74c3c', '#f39c12'];

  const drivers = top3.map((result, idx) => {
    const s1 = timeToSeconds(result.sector1);
    const s2 = timeToSeconds(result.sector2);
    const s3 = timeToSeconds(result.sector3);
    const total = s1 + s2 + s3;

    return {
      name: result.driver,
      position: result.position,
      sector1: s1,
      sector2: s2,
      sector3: s3,
      totalTime: total,
      color: colors[idx],
      currentSector: 0,
      progress: 0,
      finished: false,
      finishTime: null,
      lanePosition: 1 // Start in middle lane (0=top, 1=middle, 2=bottom)
    };
  });

  const ANIMATION_DURATION = 4000;
  
  const getPositions = () => {
    const startX = 80;
    const finishX = canvas.width - 80;
    const trackLength = finishX - startX;
    
    return {
      startX,
      finishX,
      trackLength,
      sector1End: startX + (trackLength / 3),
      sector2End: startX + (2 * trackLength / 3)
    };
  };

  const slowestTime = Math.max(...drivers.map(d => d.totalTime));

function drawTrack() {
  const { startX, finishX, sector1End, sector2End } = getPositions();
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const laneHeight = canvas.height / 3;
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 5]);
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(startX, i * laneHeight);
    ctx.lineTo(finishX, i * laneHeight);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = '#bbb';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  
  ctx.beginPath();
  ctx.moveTo(sector1End, 0);
  ctx.lineTo(sector1End, canvas.height);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(sector2End, 0);
  ctx.lineTo(sector2End, canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#999';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('S1', (startX + sector1End) / 2, 15);
  ctx.fillText('S2', (sector1End + sector2End) / 2, 15);
  ctx.fillText('S3', (sector2End + finishX) / 2, 15);
  
  // START line
  ctx.strokeStyle = '#2ecc71';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(startX, 0);
  ctx.lineTo(startX, canvas.height);
  ctx.stroke();

  // START label - rotated 90deg clockwise, bigger, and centered to the LEFT of start line
  ctx.save();
  ctx.translate(startX - 15, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = '#2ecc71';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('START', 0, 0);
  ctx.restore();
  
  // Draw checkered flag at finish line
  drawCheckeredFlag(finishX);

  // FINISH label - rotated 90deg clockwise, bigger, and centered
  ctx.save();
  ctx.translate(finishX, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = '#2c3e50';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FINISH', 0, 0);
  ctx.restore();
}

function drawCheckeredFlag(x) {
  const squareSize = 8;
  const flagHeight = canvas.height;
  const cols = 3;
  const rows = Math.ceil(flagHeight / squareSize);

  // Calculate the vertical range where "FINISH" text will be (center area)
  const textAreaTop = (canvas.height / 2) - 40; // Give 40px above center
  const textAreaBottom = (canvas.height / 2) + 40; // Give 40px below center

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const squareY = row * squareSize;
      
      // Skip drawing squares in the text area
      if (squareY >= textAreaTop && squareY <= textAreaBottom) {
        continue;
      }
      
      const isBlack = (row + col) % 2 === 0;
      ctx.fillStyle = isBlack ? '#2c3e50' : '#fff';
      ctx.fillRect(
        x - (cols * squareSize / 2) + (col * squareSize),
        row * squareSize,
        squareSize,
        squareSize
      );
    }
  }

  // Draw border for top section
  const topSectionHeight = Math.floor(textAreaTop / squareSize) * squareSize;
  if (topSectionHeight > 0) {
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      x - (cols * squareSize / 2),
      0,
      cols * squareSize,
      topSectionHeight
    );
  }

  // Draw border for bottom section
  const bottomSectionStart = Math.ceil(textAreaBottom / squareSize) * squareSize;
  const bottomSectionHeight = flagHeight - bottomSectionStart;
  if (bottomSectionHeight > 0) {
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      x - (cols * squareSize / 2),
      bottomSectionStart,
      cols * squareSize,
      bottomSectionHeight
    );
  }
}


  function drawGlowingLane(startX, finishX, laneY, laneHeight, color) {
    ctx.save();

    const gradient = ctx.createLinearGradient(startX, 0, finishX, 0);
    
    const lightColor = hexToRgba(color, 0.1);
    const mediumColor = hexToRgba(color, 0.2);
    const strongColor = hexToRgba(color, 0.3);
    
    gradient.addColorStop(0, lightColor);
    gradient.addColorStop(0.7, mediumColor);
    gradient.addColorStop(1, strongColor);

    ctx.fillStyle = gradient;
    
    const laneTop = laneY - laneHeight/2 + 5;
    const stripHeight = laneHeight - 10;
    
    ctx.fillRect(startX, laneTop, finishX - startX, stripHeight);

    ctx.restore();
  }

  function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function drawFinishCarpet(finishX, laneY, finishPosition, driverColor) {
    const carpetWidth = 35;
    const carpetHeight = 25;
    const carpetX = finishX - carpetWidth - 10;
    const carpetY = laneY - carpetHeight / 2;

    ctx.save();

    let carpetBaseColor;
    if (finishPosition === 1) {
      carpetBaseColor = '#FFD700';
    } else if (finishPosition === 2) {
      carpetBaseColor = '#C0C0C0';
    } else if (finishPosition === 3) {
      carpetBaseColor = '#CD7F32';
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(carpetX + 2, carpetY + 2, carpetWidth, carpetHeight);

    const gradient = ctx.createLinearGradient(carpetX, carpetY, carpetX, carpetY + carpetHeight);
    gradient.addColorStop(0, carpetBaseColor);
    gradient.addColorStop(1, shadeColor(carpetBaseColor, -20));
    ctx.fillStyle = gradient;
    ctx.fillRect(carpetX, carpetY, carpetWidth, carpetHeight);

    ctx.strokeStyle = driverColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(carpetX, carpetY, carpetWidth, carpetHeight);

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    ctx.strokeRect(carpetX + 3, carpetY + 3, carpetWidth - 6, carpetHeight - 6);

    ctx.fillStyle = '#2c3e50';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const ordinal = finishPosition === 1 ? 'st' : finishPosition === 2 ? 'nd' : 'rd';
    ctx.fillText(`${finishPosition}${ordinal}`, carpetX + carpetWidth / 2, carpetY + carpetHeight / 2);

    if (finishPosition === 1) {
      drawSparkles(carpetX + carpetWidth / 2, carpetY + carpetHeight / 2, carpetWidth);
    }

    ctx.restore();
  }

  function shadeColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return '#' + (
      0x1000000 +
      (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
      (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
      (B < 255 ? (B < 1 ? 0 : B) : 255)
    ).toString(16).slice(1);
  }

  function drawSparkles(x, y, size) {
    const sparkleCount = 4;
    const sparkleSize = 3;
    const sparkleDistance = size / 2 + 5;
    
    ctx.fillStyle = '#FFD700';
    
    for (let i = 0; i < sparkleCount; i++) {
      const angle = (Math.PI * 2 / sparkleCount) * i + (Date.now() / 500);
      const sx = x + Math.cos(angle) * sparkleDistance;
      const sy = y + Math.sin(angle) * sparkleDistance;
      
      ctx.beginPath();
      for (let j = 0; j < 5; j++) {
        const starAngle = (Math.PI * 2 / 5) * j + angle;
        const radius = j % 2 === 0 ? sparkleSize : sparkleSize / 2;
        const px = sx + Math.cos(starAngle) * radius;
        const py = sy + Math.sin(starAngle) * radius;
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawCar(x, y, color, driverName, position) {
    const carWidth = 50;
    const carHeight = 18;

    ctx.save();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - carWidth/2 + 5, y - carHeight/2);
    ctx.lineTo(x + carWidth/2 - 3, y - carHeight/2);
    ctx.quadraticCurveTo(x + carWidth/2, y - carHeight/2, x + carWidth/2, y - carHeight/2 + 3);
    ctx.lineTo(x + carWidth/2, y + carHeight/2 - 3);
    ctx.quadraticCurveTo(x + carWidth/2, y + carHeight/2, x + carWidth/2 - 3, y + carHeight/2);
    ctx.lineTo(x - carWidth/2 + 5, y + carHeight/2);
    ctx.quadraticCurveTo(x - carWidth/2 + 2, y + carHeight/2, x - carWidth/2 + 2, y + carHeight/2 - 3);
    ctx.lineTo(x - carWidth/2 + 2, y - carHeight/2 + 3);
    ctx.quadraticCurveTo(x - carWidth/2 + 2, y - carHeight/2, x - carWidth/2 + 5, y - carHeight/2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x + carWidth/6, y, carWidth/4, carHeight/3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(x + carWidth/2, y - carHeight/2 - 2);
    ctx.lineTo(x + carWidth/2 + 5, y - carHeight/2 - 1);
    ctx.lineTo(x + carWidth/2 + 5, y + carHeight/2 + 1);
    ctx.lineTo(x + carWidth/2, y + carHeight/2 + 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(x - carWidth/2 + 2, y - carHeight/2 - 3);
    ctx.lineTo(x - carWidth/2 - 3, y - carHeight/2 - 2);
    ctx.lineTo(x - carWidth/2 - 3, y + carHeight/2 + 2);
    ctx.lineTo(x - carWidth/2 + 2, y + carHeight/2 + 3);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#1a1a1a';
    const wheelRadius = 4;
    const wheelOffset = carWidth/3;
    
    ctx.beginPath();
    ctx.arc(x + wheelOffset, y - carHeight/2 - 1, wheelRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + wheelOffset, y + carHeight/2 + 1, wheelRadius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.beginPath();
    ctx.arc(x - wheelOffset, y - carHeight/2 - 1, wheelRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - wheelOffset, y + carHeight/2 + 1, wheelRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    const rimRadius = 2;
    ctx.beginPath();
    ctx.arc(x + wheelOffset, y - carHeight/2 - 1, rimRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + wheelOffset, y + carHeight/2 + 1, rimRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - wheelOffset, y - carHeight/2 - 1, rimRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - wheelOffset, y + carHeight/2 + 1, rimRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - carWidth/2 + 8, y - 2);
    ctx.lineTo(x + carWidth/2 - 5, y - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - carWidth/2 + 8, y + 2);
    ctx.lineTo(x + carWidth/2 - 5, y + 2);
    ctx.stroke();

    ctx.restore();

    ctx.fillStyle = '#2c3e50';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'left';
    const profile = DRIVER_PROFILES[encodeKey(driverName)] || {};
    
    let displayName;
    if (currentUser && profile.name && profile.surname) {
      displayName = `${profile.name.charAt(0)}. ${profile.surname}`;
    } else if (profile.name && profile.surname) {
      displayName = `${profile.name.charAt(0)}. ${profile.surname.charAt(0)}.`;
    } else {
      displayName = driverName;
    }
    
    ctx.fillText(`P${position} ${displayName}`, x + carWidth/2 + 8, y + 4);
  }

  // Calculate cumulative times at each sector end for sorting
  function getCumulativeTime(driver, elapsedRealTime) {
    if (elapsedRealTime <= driver.sector1) {
      return elapsedRealTime;
    } else if (elapsedRealTime <= driver.sector1 + driver.sector2) {
      return elapsedRealTime;
    } else {
      return elapsedRealTime;
    }
  }

function animate() {
  const { startX, finishX, sector1End, sector2End } = getPositions();
  
  const now = Date.now();
  const elapsed = now - startTime;
  
  // Slow down the last 20% of the race for dramatic effect
  let adjustedProgress;
  if (elapsed / ANIMATION_DURATION < 0.8) {
    adjustedProgress = (elapsed / ANIMATION_DURATION) / 0.8 * 0.8;
  } else {
    const remainingProgress = (elapsed / ANIMATION_DURATION - 0.8) / 0.2;
    adjustedProgress = 0.8 + (remainingProgress * 0.5 * 0.2);
  }
  
  const progress = Math.min(adjustedProgress, 1);

  drawTrack();

  const laneHeight = canvas.height / 3;
  let finishOrder = [];

  const trackLength = finishX - startX;
  
  // Calculate each driver's position
  const driverStates = drivers.map((driver, idx) => {
    // Calculate overall progress for this driver (faster drivers finish earlier)
    const timeRatio = driver.totalTime / slowestTime;
    const driverProgress = Math.min(progress / timeRatio, 1);
    
    // Simple linear position for visual
    let x = startX + (trackLength * driverProgress);
    let finished = false;
    
    if (driverProgress >= 1) {
      x = finishX;
      finished = true;
      
      if (!driver.finished) {
        driver.finished = true;
        driver.finishTime = now;
      }
    }

    if (driver.finished) {
      finishOrder.push({ driver, idx, finishTime: driver.finishTime });
    }

    // For ranking: calculate which drivers have completed each sector based on their times
    // Use actual sector times to determine ranking
    let rankingScore = 0;
    
    // Figure out where we are in the overall race
    const fastestS1 = Math.min(...drivers.map(d => d.sector1));
    const fastestS1S2 = Math.min(...drivers.map(d => d.sector1 + d.sector2));
    const fastestTotal = Math.min(...drivers.map(d => d.totalTime));
    
    // Determine race phase based on fastest driver
    const globalElapsed = progress * fastestTotal;
    
    if (globalElapsed < fastestS1) {
      // Phase 1: Everyone in S1, rank by S1 time (lower is better)
      rankingScore = driver.sector1;
    } else if (globalElapsed < fastestS1S2) {
      // Phase 2: Best drivers in S2, rank by S1+S2 cumulative (lower is better)
      rankingScore = driver.sector1 + driver.sector2;
    } else {
      // Phase 3: In S3, rank by total time (lower is better)
      rankingScore = driver.totalTime;
    }

    return {
      driver,
      idx,
      x,
      xProgress: driverProgress,
      rankingScore, // Lower is better
      finished: driver.finished
    };
  });

  // Sort by ranking score (LOWER is better = ahead = top lane)
  driverStates.sort((a, b) => {
    if (Math.abs(a.rankingScore - b.rankingScore) > 0.001) {
      return a.rankingScore - b.rankingScore;
    }
    return a.idx - b.idx; // Stable sort by original position
  });

  // Assign lanes with smooth transitions
  driverStates.forEach((state, position) => {
    state.targetLane = position;
    
    const currentLane = state.driver.lanePosition;
    const laneChangeSpeed = 0.01;
    
    if (Math.abs(currentLane - state.targetLane) < 0.01) {
      state.driver.lanePosition = state.targetLane;
    } else if (currentLane < state.targetLane) {
      state.driver.lanePosition = Math.min(currentLane + laneChangeSpeed, state.targetLane);
    } else if (currentLane > state.targetLane) {
      state.driver.lanePosition = Math.max(currentLane - laneChangeSpeed, state.targetLane);
    }
  });

  // Draw glowing lanes for finished drivers
  driverStates.forEach(state => {
    if (state.finished) {
      const laneY = (state.driver.lanePosition + 0.5) * laneHeight;
      drawGlowingLane(startX, finishX, laneY, laneHeight, state.driver.color);
    }
  });

  // Draw cars
  driverStates.forEach(state => {
    const laneY = (state.driver.lanePosition + 0.5) * laneHeight;
    drawCar(state.x, laneY, state.driver.color, state.driver.name, state.driver.position);
  });

  // Draw finish carpets
  if (finishOrder.length > 0) {
    finishOrder.sort((a, b) => a.finishTime - b.finishTime);
    finishOrder.forEach((item, finishPos) => {
      const laneY = (item.driver.lanePosition + 0.5) * laneHeight;
      drawFinishCarpet(finishX, laneY, finishPos + 1, item.driver.color);
    });
  }

  if (progress < 1) {
    animationId = requestAnimationFrame(animate);
  } else {
    isAnimating = false;
  }
}


  let startTime;

 function startAnimation() {
  if (animationId) {
    cancelAnimationFrame(animationId);
  }
  
  drivers.forEach(d => {
    d.progress = 0;
    d.finished = false;
    d.finishTime = null;
    d.lanePosition = 1; // Reset ALL cars to middle lane at start
  });

  isAnimating = true;
  startTime = Date.now();
  animationId = requestAnimationFrame(animate);
}

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !hasAnimated) {
        hasAnimated = true;
        setTimeout(() => startAnimation(), 300);
      }
    });
  }, {
    threshold: 0.3
  });

  observer.observe(canvas);

  replayBtn.addEventListener('click', () => {
    hasAnimated = true;
    startAnimation();
  });
}

/* -----------------------------
   Core: Leaderboard (season-aware)
   ----------------------------- */
async function loadLeaderboard() {
  try {
    const seasonSelect = document.getElementById('seasonSelect');
    const selectedSeason = seasonSelect?.value || '';

    const [roundDataSnapshot, rawLapsSnapshot] = await Promise.all([
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Round_Data')),
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Form_responses_1'))
    ]);
    
    const roundData = toArray(roundDataSnapshot.val()).filter(r => r && r.Driver);
    const rawLapsData = toArray(rawLapsSnapshot.val()).filter(r => r && r.Driver);

    const filteredRoundData = selectedSeason 
      ? roundData.filter(r => String(r.Season) == String(selectedSeason))
      : roundData;

    const driverMap = {};
    
    filteredRoundData.forEach(row => {
      const name = row.Driver;
      if (!driverMap[name]) {
        driverMap[name] = { driver: name, points: 0, purpleSectors: 0, wins: 0 };
      }
      driverMap[name].points += parseInt(row['Total_Points']) || 0;
      driverMap[name].purpleSectors += parseInt(row['Purple_Sectors']) || 0;
      if (parseInt(row.Position) === 1) driverMap[name].wins += 1;
    });

    const filteredLaps = selectedSeason 
      ? rawLapsData.filter(r => String(r.Season) == String(selectedSeason))
      : rawLapsData;
    
    filteredLaps.forEach(lap => {
      if (!driverMap[lap.Driver]) {
        driverMap[lap.Driver] = { driver: lap.Driver, points: 0, purpleSectors: 0, wins: 0 };
      }
    });

    const driversArr = Object.values(driverMap);
    driversArr.sort((a,b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.purpleSectors - a.purpleSectors;
    });

    const displayData = driversArr.map((d,i)=>({
      position: i+1,
      driver: d.driver,
      points: d.points,
      purpleSectors: d.purpleSectors,
      wins: d.wins
    }));

    displayLeaderboard(displayData);

    document.getElementById('totalDrivers').textContent = displayData.length;
    const totalPoints = displayData.reduce((s,d)=>s + (d.points||0), 0);
    document.getElementById('totalPoints').textContent = totalPoints;

    const roundSubmissions = {};
    filteredLaps.forEach(lap => {
      const key = `S${lap.Season}-R${lap.Round}`;
      if (!roundSubmissions[key]) roundSubmissions[key] = new Set();
      roundSubmissions[key].add(lap.Driver);
    });
    
    const completedRounds = Object.values(roundSubmissions).filter(drivers => drivers.size >= 3).length;
    document.getElementById('totalRounds').textContent = completedRounds;

    createPointsProgressionGraph(filteredRoundData, selectedSeason);

    populateSeasonFilter();

  } catch (err) {
    console.error('loadLeaderboard error', err);
  }
}



function displayLeaderboard(data) {
  const tbody = document.getElementById('leaderboard-body');
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();

  data.forEach((row,index) => {
    const tr = document.createElement('tr');
    if (index === 0) tr.classList.add('position-1');
    if (index === 1) tr.classList.add('position-2');
    if (index === 2) tr.classList.add('position-3');

    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';

    const formattedName = getFormattedDriverName(row.driver);

    tr.innerHTML = `
      <td data-label="Position"><span class="medal">${medal}</span>${row.position}</td>
      <td data-label="Driver"><strong style="cursor:pointer;color:#667eea;" class="driver-link" data-driver="${row.driver}">${formattedName}</strong></td>
      <td data-label="Points"><strong>${row.points}</strong></td>
      <td data-label="Purple Sectors">${row.purpleSectors}</td>
      <td data-label="Wins">${row.wins}</td>
    `;
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);

  tbody.querySelectorAll('.driver-link').forEach(link=>{
    link.addEventListener('click', function(e){
      const driverName = this.getAttribute('data-driver');
      goToDriverCurrentRound(driverName);
    });
  });

  document.getElementById('leaderboard-loading').style.display = 'none';
  document.getElementById('leaderboard-content').style.display = 'block';
}

/* -----------------------------
   Populate season dropdown helper
   ----------------------------- */
async function populateSeasonFilter() {
  try {
    if (!CACHE.setupArray) {
      const setupRef = window.firebaseRef(window.firebaseDB, 'Form_responses_2');
      const snap = await window.firebaseGet(setupRef);
      CACHE.setupArray = toArray(snap.val());
    }
    const setupData = CACHE.setupArray || [];

    const seasons = [...new Set(setupData.map(s => s.Season))].filter(s=>s).sort((a,b)=>a-b);
    const seasonSelect = document.getElementById('seasonSelect');
    const roundSeasonSelect = document.getElementById('roundSeasonSelect');
    const setupSeasonSelect = document.getElementById('setupSeasonSelect');

    function fill(selectEl) {
      if (!selectEl) return;
      const prev = selectEl.value || '';
      selectEl.innerHTML = '<option value="">All Seasons</option>';
      seasons.forEach(season=>{
        const opt = document.createElement('option');
        opt.value = season;
        opt.textContent = `Season ${season}`;
        selectEl.appendChild(opt);
      });
      selectEl.value = prev;
    }

    fill(seasonSelect);
    fill(roundSeasonSelect);
    fill(setupSeasonSelect);

  } catch (err) {
    console.error('populateSeasonFilter error', err);
  }
}

/* -----------------------------
   Round Data (season-aware)
   ----------------------------- */
async function loadRoundData() {
  try {
    if (!CACHE.roundDataArray || !CACHE.tracksMap || !CACHE.carsMap || !CACHE.setupArray) {
      const [roundSnapshot, tracksSnapshot, carsSnapshot, setupSnapshot] = await Promise.all([
        window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Round_Data')),
        window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Tracks')),
        window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Cars')),
        window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Form_responses_2'))
      ]);
      CACHE.roundDataArray = toArray(roundSnapshot.val());
      const tracksArr = toArray(tracksSnapshot.val());
      const carsArr = toArray(carsSnapshot.val());
      CACHE.tracksMap = {};
      tracksArr.forEach(r=> { if (r && r['Track_Combos']) CACHE.tracksMap[r['Track_Combos'].trim()] = r['Track_Image_URL'] || ''; });
      CACHE.carsMap = {};
      carsArr.forEach(r=> { if (r && r['Car_Name']) CACHE.carsMap[r['Car_Name'].trim()] = r['Car_Image_URL'] || ''; });
      CACHE.setupArray = toArray(setupSnapshot.val());
    }

    const roundDataRaw = CACHE.roundDataArray;
    const tracksMap = CACHE.tracksMap;
    const carsMap = CACHE.carsMap;
    const setupArr = CACHE.setupArray;

    const roundSeasonSelect = document.getElementById('roundSeasonSelect');
    const selectedSeason = roundSeasonSelect?.value || '';

    let filtered = roundDataRaw.filter(r => r && r.Driver && r.Position);
    if (selectedSeason) filtered = filtered.filter(r => String(r.Season) == String(selectedSeason));

    const allData = filtered.map((row, idx) => {
      const ps1 = row['Purple_Sector_1'];
      const ps2 = row['Purple_Sector_2'];
      const ps3 = row['Purple_Sector_3'];
      const purpleSector1 = ps1 === 'TRUE' || ps1 === true || ps1 === 'true';
      const purpleSector2 = ps2 === 'TRUE' || ps2 === true || ps2 === 'true';
      const purpleSector3 = ps3 === 'TRUE' || ps3 === true || ps3 === 'true';

      return {
        round: row.Round,
        driver: row.Driver,
        sector1: row['Sector_1']?.toString() || '',
        sector2: row['Sector_2']?.toString() || '',
        sector3: row['Sector_3']?.toString() || '',
        totalTime: row['Total_Lap_Time']?.toString() || '',
        position: parseInt(row.Position) || 0,
        purpleSectors: parseInt(row['Purple_Sectors']) || 0,
        points: parseInt(row['Total_Points']) || 0,
        timestamp: idx,
        trackLayout: row['Track-Layout'] || '',
        car: row['Car_Name'] || '',
        season: row.Season,
        purpleSector1,
        purpleSector2,
        purpleSector3
      };
    });

    const roundGroups = {};
    allData.forEach(r => {
      const key = `S${r.season}-R${r.round}`;
      if (!roundGroups[key]) roundGroups[key] = { season: r.season, round: r.round, results: [] };
      roundGroups[key].results.push(r);
    });

    Object.keys(roundGroups).forEach(key => {
      const rs = roundGroups[key].results;
      const fastest1 = Math.min(...rs.map(r => parseFloat(r.sector1) || Infinity));
      const fastest2 = Math.min(...rs.map(r => parseFloat(r.sector2) || Infinity));
      const fastest3 = Math.min(...rs.map(r => parseFloat(r.sector3) || Infinity));
      rs.forEach(r => {
        r.purpleSector1 = parseFloat(r.sector1) === fastest1;
        r.purpleSector2 = parseFloat(r.sector2) === fastest2;
        r.purpleSector3 = parseFloat(r.sector3) === fastest3;
      });
      rs.sort((a,b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.purpleSectors !== a.purpleSectors) return b.purpleSectors - a.purpleSectors;
        return a.timestamp - b.timestamp;
      });
    });

    displayRoundData(roundGroups, tracksMap, carsMap);

  } catch (err) {
    console.error('loadRoundData error', err);
  }
}

function displayRoundData(roundGroups, tracksMap, carsMap) {
  const container = document.getElementById('round-content');
  container.innerHTML = '';
  const frag = document.createDocumentFragment();

  const fallbackTrackImage = 'https://static.vecteezy.com/system/resources/previews/015/114/628/non_2x/race-track-icon-isometric-road-circuit-vector.jpg';
  const fallbackCarImage = 'https://thumb.silhouette-ac.com/t/e9/e9f1eb16ae292f36be10def00d95ecbb_t.jpeg';

  const sortedKeys = Object.keys(roundGroups).sort((a,b) => {
    const [sa, ra] = a.replace('S','').split('-R').map(Number);
    const [sb, rb] = b.replace('S','').split('-R').map(Number);
    if (sa !== sb) return sb - sa;
    return rb - ra;
  });

  sortedKeys.forEach(key => {
    const g = roundGroups[key];
    const results = g.results;
    const season = g.season;
    const round = g.round;

    const trackLayout = results[0].trackLayout?.trim() || '';
    const car = results[0].car?.trim() || '';
    const trackImage = tracksMap[trackLayout] || fallbackTrackImage;
    const carImage = carsMap[car] || fallbackCarImage;
    const summary = results.map(r=> `${r.driver} - P${r.position} - ${r.points}pts`).join(' | ');

    const roundDiv = document.createElement('div');
    roundDiv.className = 'round-group';

    const header = document.createElement('div');
    header.className = 'round-header';
    header.innerHTML = `
      <div class="round-info-column">
        <h3>Round ${round}</h3>
        <p class="season-number">${season}</p>
        <div class="round-summary">${summary}</div>
      </div>
      <div class="round-banner-column">
        <div class="round-banner-icon">
          <img src="${trackImage}" alt="${trackLayout}" onerror="this.src='${fallbackTrackImage}'">
          <p>${trackLayout}</p>
        </div>
      </div>
      <div class="round-banner-column">
        <div class="round-banner-icon">
          <img src="${carImage}" alt="${car}" onerror="this.src='${fallbackCarImage}'">
          <p>${car}</p>
        </div>
      </div>
      <span class="toggle-icon" id="toggle-${key}">▼</span>
    `;
    header.addEventListener('click', ()=> toggleRound(key));

    const details = document.createElement('div');
    details.className = 'round-details';
    details.id = `details-${key}`;

    const table = document.createElement('table');
    table.className = 'leaderboard-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Driver</th><th>Sector 1</th><th>Sector 2</th><th>Sector 3</th>
          <th>Total Time</th><th>Gap</th><th>Position</th><th>Purple Sectors</th><th>Points</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    const winnerTime = results.length > 0 ? timeToSeconds(results[0].totalTime) : 0;

    results.forEach(row => {
      const tr = document.createElement('tr');
      if (row.position === 1) tr.classList.add('position-1');
      if (row.position === 2) tr.classList.add('position-2');
      if (row.position === 3) tr.classList.add('position-3');

      const sector1Html = row.purpleSector1 ? `<span class="purple-sector">${formatTime(row.sector1)}</span>` : formatTime(row.sector1);
      const sector2Html = row.purpleSector2 ? `<span class="purple-sector">${formatTime(row.sector2)}</span>` : formatTime(row.sector2);
      const sector3Html = row.purpleSector3 ? `<span class="purple-sector">${formatTime(row.sector3)}</span>` : formatTime(row.sector3);

      const formattedName = getFormattedDriverName(row.driver);

      let gapHtml = '';
      if (row.position === 1) {
        gapHtml = '<span style="color:#2ecc71;font-weight:bold;">Interval</span>';
      } else {
        const driverTime = timeToSeconds(row.totalTime);
        const gap = driverTime - winnerTime;
        if (gap > 0 && isFinite(gap)) {
          gapHtml = `<span style="color:#e74c3c;">+${gap.toFixed(3)}s</span>`;
        } else {
          gapHtml = '-';
        }
      }

      tr.innerHTML = `
        <td data-label="Driver"><strong class="driver-link-round" data-driver="${row.driver}" style="cursor:pointer;color:#667eea">${formattedName}</strong></td>
        <td data-label="Sector 1">${sector1Html}</td>
        <td data-label="Sector 2">${sector2Html}</td>
        <td data-label="Sector 3">${sector3Html}</td>
        <td data-label="Total Time"><strong>${formatTime(row.totalTime)}</strong></td>
        <td data-label="Gap">${gapHtml}</td>
        <td data-label="Position">${row.position}</td>
        <td data-label="Purple Sectors">${row.purpleSectors}</td>
        <td data-label="Points"><strong>${row.points}</strong></td>
      `;
      tbody.appendChild(tr);
    });

    details.appendChild(table);

    const raceAnimationHtml = createRaceAnimation(key, results);
    if (raceAnimationHtml) {
      const raceDiv = document.createElement('div');
      raceDiv.innerHTML = raceAnimationHtml;
      details.appendChild(raceDiv.firstElementChild);
    }

    roundDiv.appendChild(header);
    roundDiv.appendChild(details);
    frag.appendChild(roundDiv);
  });

  container.appendChild(frag);

  container.querySelectorAll('.driver-link-round').forEach(link => {
    link.addEventListener('click', function() {
      goToDriverProfile(this.getAttribute('data-driver'));
    });
  });

  if (sortedKeys.length > 0) {
    setTimeout(() => {
      const latestKey = sortedKeys[0];
      const d = document.getElementById(`details-${latestKey}`);
      const i = document.getElementById(`toggle-${latestKey}`);
      if (d) d.classList.add('expanded');
      if (i) i.classList.add('expanded');
    }, 150);
  }

  document.getElementById('round-loading').style.display = 'none';
  document.getElementById('round-content').style.display = 'block';
}

/* -----------------------------
   Round Setup & Cards
   ----------------------------- */
async function loadTracksAndCars() {
  if (!CACHE.tracksMap || !CACHE.carsMap) {
    const [tracksSnap, carsSnap] = await Promise.all([
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Tracks')),
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Cars'))
    ]);
    const tracks = toArray(tracksSnap.val());
    const cars = toArray(carsSnap.val());
    CACHE.tracksMap = {}; tracks.forEach(r=> { if (r && r['Track_Combos']) CACHE.tracksMap[r['Track_Combos'].trim()] = r['Track_Image_URL'] || ''; });
    CACHE.carsMap = {}; cars.forEach(r=> { if (r && r['Car_Name']) CACHE.carsMap[r['Car_Name'].trim()] = r['Car_Image_URL'] || ''; });
  }

  const trackSelect = document.getElementById('trackLayout');
  const carSelect = document.getElementById('carName');
  if (trackSelect) {
    trackSelect.innerHTML = '<option value="">-- Select Track & Layout --</option>';
    Object.keys(CACHE.tracksMap).sort().forEach(t => {
      const opt = document.createElement('option'); opt.value = t; opt.textContent = t; trackSelect.appendChild(opt);
    });
  }
  if (carSelect) {
    carSelect.innerHTML = '<option value="">-- Select Car --</option>';
    Object.keys(CACHE.carsMap).sort().forEach(c => {
      const opt = document.createElement('option'); opt.value = c; opt.textContent = c; carSelect.appendChild(opt);
    });
  }
}

document.getElementById('roundSetupForm')?.addEventListener('submit', async function(e){
  e.preventDefault();
  const roundNumber = parseInt(document.getElementById('roundNumber').value);
  const trackLayout = document.getElementById('trackLayout').value;
  const carName = document.getElementById('carName').value;
  const season = parseInt(document.getElementById('season').value);
  const messageDiv = document.getElementById('setupMessage');
  if (!messageDiv) return;
  messageDiv.style.display = 'block'; messageDiv.textContent = '⏳ Saving round configuration...';

  try {
    const setupData = { Timestamp: new Date().toISOString(), Round_Number: roundNumber, 'Track-Layout': trackLayout, Car_Name: carName, Season: season };
    const setupRef = window.firebaseRef(window.firebaseDB, 'Form_responses_2');
    await window.firebasePush(setupRef, setupData);
    messageDiv.style.background = '#d4edda'; messageDiv.style.color = '#155724'; messageDiv.textContent = '✅ Round configuration saved!';
    document.getElementById('roundSetupForm').reset();
    CACHE.setupArray = null;
    await wait(350);
    loadRoundSetup();
    setTimeout(()=> messageDiv.style.display = 'none', 1800);
  } catch (err) {
    console.error('round setup save error', err);
    messageDiv.style.background = '#f8d7da'; messageDiv.style.color = '#721c24'; messageDiv.textContent = '❌ ' + err.message;
  }
});



async function loadRoundSetup() {
  try {
    const [setupSnap, roundSnap] = await Promise.all([
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Form_responses_2')),
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Round_Data'))
    ]);
    const setupArr = toArray(setupSnap.val());
    const roundArr = toArray(roundSnap.val());

    const unique = {};
    setupArr.forEach(row => {
      if (!row || !row.Round_Number) return;
      const key = `${row.Season}-${row.Round_Number}`;
      const time = new Date(row.Timestamp).getTime() || 0;
      if (!unique[key] || time > unique[key].time) unique[key] = { ...row, time };
    });
    const finalSetup = Object.values(unique).map(u=> ({ round: u.Round_Number, trackLayout: u['Track-Layout'], car: u.Car_Name, season: u.Season }));

    displayRoundCards(finalSetup, roundArr, CACHE.tracksMap || {}, CACHE.carsMap || {});
    document.getElementById('setup-cards-loading').style.display = 'none';
    document.getElementById('setup-cards-content').style.display = 'block';
    CACHE.setupArray = setupArr;
    populateSeasonFilter();

  } catch (err) {
    console.error('loadRoundSetup error', err);
  }
}

/* -----------------------------
   Admin Tools - Lap Time Management
   ----------------------------- */
let ADMIN_USERNAME = null;

function isAdmin() {
  if (!currentUser || !ADMIN_USERNAME) return false;
  
  // Support wildcard: "*" means all users are admins
  if (ADMIN_USERNAME === '*') return true;
  
  // Support comma-separated list: "Olaf,Alex,Ben"
  const adminList = ADMIN_USERNAME.split(',').map(name => name.trim());
  return adminList.includes(currentUser.name);
}

function updateAdminUsername(configMap) {
  ADMIN_USERNAME = configMap['admin_username'] || null;
  console.log('Admin username set to:', ADMIN_USERNAME);
  console.log('Current user:', currentUser);
  console.log('Is admin?', isAdmin());
  updateAdminTabVisibility();
}

function updateAdminTabVisibility() {
  const adminTab = document.querySelector('.tab-button[onclick*="admin"]');
  if (adminTab) {
    adminTab.style.display = isAdmin() ? '' : 'none';
  }
}

/*
async function loadAdminTools() {
  if (!isAdmin()) {
    document.getElementById('admin-content').innerHTML = '<p style="text-align:center;padding:40px;color:#666;">Access Denied</p>';
    return;
  }

  try {
    const lapsSnapshot = await window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Form_responses_1'));
    const lapsData = toArray(lapsSnapshot.val());
    
    const lapsWithKeys = [];
    const lapsObject = lapsSnapshot.val();
    if (lapsObject && typeof lapsObject === 'object') {
      Object.keys(lapsObject).forEach(key => {
        if (lapsObject[key]) {
          lapsWithKeys.push({ ...lapsObject[key], _firebaseKey: key });
        }
      });
    }

    displayAdminLapTimes(lapsWithKeys);

  } catch (err) {
    console.error('loadAdminTools error', err);
  }
}


// Store current filter state globally
let currentAdminFilters = {
  driver: '',
  season: '',
  round: ''
};
*/

function displayAdminLapTimes(lapsData) {
  const container = document.getElementById('admin-lap-times-table');
  if (!container) return;

  const drivers = [...new Set(lapsData.map(l => l.Driver).filter(Boolean))].sort();
  const seasons = [...new Set(lapsData.map(l => l.Season).filter(Boolean))].sort((a,b) => b-a);
  const rounds = [...new Set(lapsData.map(l => l.Round).filter(Boolean))].sort((a,b) => a-b);

  const filterHtml = `
    <div class="admin-filters">
      <select id="adminFilterDriver" class="admin-filter-select" onchange="filterAdminLaps()">
        <option value="">All Drivers</option>
        ${drivers.map(d => `<option value="${d}" ${currentAdminFilters.driver === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <select id="adminFilterSeason" class="admin-filter-select" onchange="filterAdminLaps()">
        <option value="">All Seasons</option>
        ${seasons.map(s => `<option value="${s}" ${String(currentAdminFilters.season) === String(s) ? 'selected' : ''}>Season ${s}</option>`).join('')}
      </select>
      <select id="adminFilterRound" class="admin-filter-select" onchange="filterAdminLaps()">
        <option value="">All Rounds</option>
        ${rounds.map(r => `<option value="${r}" ${String(currentAdminFilters.round) === String(r) ? 'selected' : ''}>Round ${r}</option>`).join('')}
      </select>
      <button onclick="clearAdminFilters()" class="admin-filter-btn">Clear Filters</button>
    </div>
  `;

  lapsData.sort((a, b) => {
    const timeA = new Date(a.Timestamp).getTime();
    const timeB = new Date(b.Timestamp).getTime();
    return timeB - timeA;
  });

  const tableHtml = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Driver</th>
          <th>Season</th>
          <th>Round</th>
          <th>Sector 1</th>
          <th>Sector 2</th>
          <th>Sector 3</th>
          <th onclick="sortAdminByTotalTime()" style="cursor:pointer;" title="Click to sort">
            Total Time <span id="sortIndicator">⇅</span>
          </th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="adminLapsTableBody">
        ${lapsData.map(lap => createAdminLapRow(lap)).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = filterHtml + tableHtml;

  window.adminLapsData = lapsData;
  
  // Reapply filters if they exist
  if (currentAdminFilters.driver || currentAdminFilters.season || currentAdminFilters.round) {
    filterAdminLaps();
  }
}



function createAdminLapRow(lap) {
  const timestamp = new Date(lap.Timestamp).toLocaleString();
  const s1 = formatTime(lap.Sector_1);
  const s2 = formatTime(lap.Sector_2);
  const s3 = formatTime(lap.Sector_3);
  const total = formatTime(lap.Total_Lap_Time);

  return `
    <tr data-key="${lap._firebaseKey}">
      <td data-label="Timestamp">${timestamp}</td>
      <td data-label="Driver">${lap.Driver}</td>
      <td data-label="Season">${lap.Season}</td>
      <td data-label="Round">${lap.Round}</td>
      <td data-label="Sector 1">${s1}</td>
      <td data-label="Sector 2">${s2}</td>
      <td data-label="Sector 3">${s3}</td>
      <td data-label="Total Time">${total}</td>
      <td data-label="Actions">
        <button onclick="editAdminLap('${lap._firebaseKey}')" class="admin-btn-edit">✏️ Edit</button>
        <button onclick="deleteAdminLap('${lap._firebaseKey}')" class="admin-btn-delete">🗑️ Delete</button>
      </td>
    </tr>
  `;
}

function filterAdminLaps() {
  const driverFilter = document.getElementById('adminFilterDriver')?.value || '';
  const seasonFilter = document.getElementById('adminFilterSeason')?.value || '';
  const roundFilter = document.getElementById('adminFilterRound')?.value || '';

  // Store current filter state (as strings for consistent comparison)
  currentAdminFilters = {
    driver: driverFilter,
    season: seasonFilter,
    round: roundFilter
  };

  let filtered = window.adminLapsData || [];

  if (driverFilter) filtered = filtered.filter(l => l.Driver === driverFilter);
  if (seasonFilter) filtered = filtered.filter(l => String(l.Season) === String(seasonFilter));
  if (roundFilter) filtered = filtered.filter(l => String(l.Round) === String(roundFilter));

  const tbody = document.getElementById('adminLapsTableBody');
  if (tbody) {
    tbody.innerHTML = filtered.map(lap => createAdminLapRow(lap)).join('');
  }
}


function clearAdminFilters() {
  // Clear stored filters
  currentAdminFilters = {
    driver: '',
    season: '',
    round: ''
  };
  
  const driverFilter = document.getElementById('adminFilterDriver');
  const seasonFilter = document.getElementById('adminFilterSeason');
  const roundFilter = document.getElementById('adminFilterRound');
  
  if (driverFilter) driverFilter.value = '';
  if (seasonFilter) seasonFilter.value = '';
  if (roundFilter) roundFilter.value = '';
  
  filterAdminLaps();
}


// Add sorting functionality
//let adminSortAscending = true;

function sortAdminByTotalTime() {
  const tbody = document.getElementById('adminLapsTableBody');
  if (!tbody) return;

  // Get current rows
  const rows = Array.from(tbody.querySelectorAll('tr'));
  
  // Sort by total time
  rows.sort((a, b) => {
    const keyA = a.getAttribute('data-key');
    const keyB = b.getAttribute('data-key');
    
    const lapA = window.adminLapsData.find(l => l._firebaseKey === keyA);
    const lapB = window.adminLapsData.find(l => l._firebaseKey === keyB);
    
    if (!lapA || !lapB) return 0;
    
    const timeA = parseFloat(lapA.Total_Lap_Time) || 0;
    const timeB = parseFloat(lapB.Total_Lap_Time) || 0;
    
    return adminSortAscending ? timeA - timeB : timeB - timeA;
  });

  // Toggle sort direction for next click
  adminSortAscending = !adminSortAscending;
  
  // Update indicator
  const indicator = document.getElementById('sortIndicator');
  if (indicator) {
    indicator.textContent = adminSortAscending ? '↓' : '↑';
  }

  // Clear and re-append sorted rows
  tbody.innerHTML = '';
  rows.forEach(row => tbody.appendChild(row));
}


async function editAdminLap(firebaseKey) {
  const lap = window.adminLapsData.find(l => l._firebaseKey === firebaseKey);
  if (!lap) return;

  const modal = document.createElement('div');
  modal.className = 'admin-modal';
  modal.innerHTML = `
    <div class="admin-modal-content">
      <div class="admin-modal-header">
        <h3>Edit Lap Time</h3>
        <button onclick="closeAdminModal()" class="admin-modal-close">×</button>
      </div>
      <div class="admin-modal-body">
        <p><strong>Driver:</strong> ${lap.Driver}</p>
        <p><strong>Season:</strong> ${lap.Season} | <strong>Round:</strong> ${lap.Round}</p>
        <p><strong>Original Timestamp:</strong> ${new Date(lap.Timestamp).toLocaleString()}</p>
        
        <div class="admin-edit-form">
          <div class="admin-form-group">
            <label>Sector 1 (seconds):</label>
            <input type="number" step="0.001" id="editS1" value="${lap.Sector_1}" class="admin-input">
          </div>
          <div class="admin-form-group">
            <label>Sector 2 (seconds):</label>
            <input type="number" step="0.001" id="editS2" value="${lap.Sector_2}" class="admin-input">
          </div>
          <div class="admin-form-group">
            <label>Sector 3 (seconds):</label>
            <input type="number" step="0.001" id="editS3" value="${lap.Sector_3}" class="admin-input">
          </div>
        </div>
      </div>
      <div class="admin-modal-footer">
        <button onclick="saveAdminLapEdit('${firebaseKey}')" class="admin-btn-save">💾 Save Changes</button>
        <button onclick="closeAdminModal()" class="admin-btn-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add('show'), 10);
}

async function saveAdminLapEdit(firebaseKey) {
  try {
    const s1 = parseFloat(document.getElementById('editS1').value);
    const s2 = parseFloat(document.getElementById('editS2').value);
    const s3 = parseFloat(document.getElementById('editS3').value);

    if (!isFinite(s1) || !isFinite(s2) || !isFinite(s3)) {
      alert('❌ Invalid sector times');
      return;
    }

    const totalTime = s1 + s2 + s3;

    const lap = window.adminLapsData.find(l => l._firebaseKey === firebaseKey);
    
    const lapRef = window.firebaseRef(window.firebaseDB, `Form_responses_1/${firebaseKey}`);
    await window.firebaseSet(lapRef, {
      ...lap,
      Sector_1: s1,
      Sector_2: s2,
      Sector_3: s3,
      Total_Lap_Time: totalTime,
      Last_Modified: new Date().toISOString(),
      Modified_By: currentUser.name
    });

    //alert('✅ Lap time updated successfully!');
    closeAdminModal();
    
    // Reload admin tools but preserve filters
    await loadAdminTools();
    
    CACHE.roundDataArray = null;

  } catch (err) {
    console.error('saveAdminLapEdit error', err);
    alert('❌ Error saving: ' + err.message);
  }
}

async function deleteAdminLap(firebaseKey) {
  const lap = window.adminLapsData.find(l => l._firebaseKey === firebaseKey);
  if (!lap) return;

  const confirmMsg = `⚠️ Delete this lap time?\n\nDriver: ${lap.Driver}\nSeason ${lap.Season} - Round ${lap.Round}\nTime: ${formatTime(lap.Total_Lap_Time)}\n\nThis cannot be undone!`;
  
  if (!confirm(confirmMsg)) return;

  try {
    const lapRef = window.firebaseRef(window.firebaseDB, `Form_responses_1/${firebaseKey}`);
    await window.firebaseSet(lapRef, null);

    alert('✅ Lap time deleted successfully!');
    
    // Reload admin tools but preserve filters
    await loadAdminTools();
    
    CACHE.roundDataArray = null;

  } catch (err) {
    console.error('deleteAdminLap error', err);
    alert('❌ Error deleting: ' + err.message);
  }
}
function closeAdminModal() {
  const modal = document.querySelector('.admin-modal');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => modal.remove(), 300);
  }
}

// Load individual email toggle states
async function loadEmailToggleStates() {
  if (!isAdmin()) return;
  
  try {
    const configRef = window.firebaseRef(window.firebaseDB, 'Config');
    const snapshot = await window.firebaseGet(configRef);
    const config = snapshot.val();
    
    if (!config) return;
    
    // Set toggle states (default to true if not set)
    const newRoundEnabled = config.email_newRound_enabled !== false;
    const fastestLapEnabled = config.email_fastestLap_enabled !== false;
    const weeklyResultsEnabled = config.email_weeklyResults_enabled !== false;
    
    const newRoundToggle = document.getElementById('emailToggle_newRound');
    const fastestLapToggle = document.getElementById('emailToggle_fastestLap');
    const weeklyResultsToggle = document.getElementById('emailToggle_weeklyResults');
    const masterToggle = document.getElementById('emailToggleMaster');
    
    if (newRoundToggle) newRoundToggle.checked = newRoundEnabled;
    if (fastestLapToggle) fastestLapToggle.checked = fastestLapEnabled;
    if (weeklyResultsToggle) weeklyResultsToggle.checked = weeklyResultsEnabled;
    
    // Update master toggle based on individual states
    const allEnabled = newRoundEnabled && fastestLapEnabled && weeklyResultsEnabled;
    if (masterToggle) masterToggle.checked = allEnabled;
    
    updateEmailTypeStatus('newRound', newRoundEnabled);
    updateEmailTypeStatus('fastestLap', fastestLapEnabled);
    updateEmailTypeStatus('weeklyResults', weeklyResultsEnabled);
    
  } catch (error) {
    console.error('Error loading email toggle states:', error);
  }
}

// Toggle specific email type
async function toggleEmailType(emailType) {
  if (!isAdmin()) {
    alert('❌ Only admins can change this setting');
    return;
  }
  
  const toggleSwitch = document.getElementById(`emailToggle_${emailType}`);
  const enabled = toggleSwitch.checked;
  
  try {
    const configRef = window.firebaseRef(window.firebaseDB, `Config/email_${emailType}_enabled`);
    await window.firebaseSet(configRef, enabled);
    
    updateEmailTypeStatus(emailType, enabled);
    
    // Show confirmation
    showEmailToggleMessage(emailType, enabled);
    
    console.log(`${emailType} notifications ${enabled ? 'ENABLED' : 'PAUSED'}`);
    
  } catch (error) {
    console.error(`Error toggling ${emailType} notifications:`, error);
    alert('❌ Error updating setting: ' + error.message);
    
    // Revert toggle on error
    toggleSwitch.checked = !enabled;
  }
}

// Update visual status for specific email type
function updateEmailTypeStatus(emailType, enabled) {
  const statusBadge = document.getElementById(`emailStatus_${emailType}`);
  if (statusBadge) {
    statusBadge.textContent = enabled ? 'ACTIVE' : 'PAUSED';
    statusBadge.className = enabled ? 'admin-email-status-badge active' : 'admin-email-status-badge paused';
  }
}

// Show toggle confirmation message
function showEmailToggleMessage(emailType, enabled) {
  const statusDiv = document.getElementById('emailToggleGlobalStatus');
  if (!statusDiv) return;
  
  const typeNames = {
    newRound: 'New Round',
    fastestLap: 'Fastest Lap',
    weeklyResults: 'Weekly Results'
  };
  
  statusDiv.style.display = 'block';
  statusDiv.style.background = enabled ? '#d4edda' : '#fff3cd';
  statusDiv.style.color = enabled ? '#155724' : '#856404';
  statusDiv.textContent = enabled 
    ? `✅ ${typeNames[emailType]} notifications are now ENABLED` 
    : `⏸️ ${typeNames[emailType]} notifications are now PAUSED`;
  
  setTimeout(() => {
    statusDiv.style.display = 'none';
  }, 3000);
}

// Master toggle - enables/disables all email types at once
async function toggleAllEmails() {
  if (!isAdmin()) {
    alert('❌ Only admins can change this setting');
    return;
  }
  
  const masterToggle = document.getElementById('emailToggleMaster');
  const enabled = masterToggle.checked;
  
  try {
    const configRef = window.firebaseRef(window.firebaseDB, 'Config');
    
    // Get current config
    const snapshot = await window.firebaseGet(configRef);
    const currentConfig = snapshot.val() || {};
    
    // Update email toggles while preserving other config
    await window.firebaseSet(configRef, {
      ...currentConfig,
      email_newRound_enabled: enabled,
      email_fastestLap_enabled: enabled,
      email_weeklyResults_enabled: enabled
    });
    
    // Update all individual toggles
    const newRoundToggle = document.getElementById('emailToggle_newRound');
    const fastestLapToggle = document.getElementById('emailToggle_fastestLap');
    const weeklyResultsToggle = document.getElementById('emailToggle_weeklyResults');
    
    if (newRoundToggle) newRoundToggle.checked = enabled;
    if (fastestLapToggle) fastestLapToggle.checked = enabled;
    if (weeklyResultsToggle) weeklyResultsToggle.checked = enabled;
    
    updateEmailTypeStatus('newRound', enabled);
    updateEmailTypeStatus('fastestLap', enabled);
    updateEmailTypeStatus('weeklyResults', enabled);
    
    const statusDiv = document.getElementById('emailToggleGlobalStatus');
    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.background = enabled ? '#d4edda' : '#fff3cd';
      statusDiv.style.color = enabled ? '#155724' : '#856404';
      statusDiv.textContent = enabled 
        ? '✅ ALL email notifications are now ENABLED' 
        : '⏸️ ALL email notifications are now PAUSED';
      
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    }
    
    console.log(`All email notifications ${enabled ? 'ENABLED' : 'PAUSED'}`);
    
  } catch (error) {
    console.error('Error toggling all email notifications:', error);
    alert('❌ Error updating settings: ' + error.message);
    masterToggle.checked = !enabled;
  }
}

// ============================================================================
// STEP 2: UPDATE YOUR displayAdminInterface() FUNCTION
// Find this function and update it with the email toggle section
// ============================================================================


function displayAdminInterface(lapsData, tracksData, carsData, emailLogsData) {
  const container = document.getElementById('admin-lap-times-table');
  if (!container) return;

  // Admin tabs navigation
  const tabsHtml = `
    <div class="admin-tabs">
      <button class="admin-tab-button ${currentAdminTab === 'time-submissions' ? 'active' : ''}" onclick="switchAdminTab('time-submissions')">
        ⏱️ Time Submissions
      </button>
      <button class="admin-tab-button ${currentAdminTab === 'tracks-config' ? 'active' : ''}" onclick="switchAdminTab('tracks-config')">
        🏁 Tracks Config
      </button>
      <button class="admin-tab-button ${currentAdminTab === 'cars-config' ? 'active' : ''}" onclick="switchAdminTab('cars-config')">
        🏎️ Cars Config
      </button>
      <button class="admin-tab-button ${currentAdminTab === 'email-logs' ? 'active' : ''}" onclick="switchAdminTab('email-logs')">
        📧 Email Logs
      </button>
    </div>
  `;

  // REMOVED emailToggleHtml from here - it's now in generateEmailLogsContent()

  let contentHtml = '';

  if (currentAdminTab === 'time-submissions') {
    contentHtml = generateTimeSubmissionsContent(lapsData);
  } else if (currentAdminTab === 'tracks-config') {
    contentHtml = generateTracksConfigContent(tracksData);
  } else if (currentAdminTab === 'cars-config') {
    contentHtml = generateCarsConfigContent(carsData);
  } else if (currentAdminTab === 'email-logs') {
    contentHtml = generateEmailLogsContent(emailLogsData);
  }

  // CHANGED: No longer including emailToggleHtml here
  container.innerHTML = tabsHtml + contentHtml;

  window.adminLapsData = lapsData;
  
  // Load email toggle states only when on email-logs tab
  if (currentAdminTab === 'email-logs') {
    setTimeout(() => loadEmailToggleStates(), 100);
  }
  
  // Reapply filters if on time submissions tab
  if (currentAdminTab === 'time-submissions' && (currentAdminFilters.driver || currentAdminFilters.season || currentAdminFilters.round)) {
    filterAdminLaps();
  }
}


// ============================================================================
// STEP 3: MAKE SURE YOUR loadAdminTools() LOADS EMAIL LOGS
// Update this section if it's not already loading email logs
// ============================================================================

async function loadAdminTools() {
  if (!isAdmin()) {
    document.getElementById('admin-content').innerHTML = '<p style="text-align:center;padding:40px;color:#666;">Access Denied</p>';
    return;
  }

  try {
    const [lapsSnapshot, tracksSnapshot, carsSnapshot, emailLogsSnapshot] = await Promise.all([
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Form_responses_1')),
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Tracks')),
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Cars')),
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Email_Logs'))
    ]);
    
    const lapsData = toArray(lapsSnapshot.val());
    const tracksData = toArray(tracksSnapshot.val());
    const carsData = toArray(carsSnapshot.val());
    
    const lapsWithKeys = [];
    const lapsObject = lapsSnapshot.val();
    if (lapsObject && typeof lapsObject === 'object') {
      Object.keys(lapsObject).forEach(key => {
        if (lapsObject[key]) {
          lapsWithKeys.push({ ...lapsObject[key], _firebaseKey: key });
        }
      });
    }

    // Process email logs
    const emailLogsData = [];
    const emailLogsObject = emailLogsSnapshot.val();
    if (emailLogsObject && typeof emailLogsObject === 'object') {
      Object.entries(emailLogsObject).forEach(([key, value]) => {
        emailLogsData.push({ id: key, ...value });
      });
    }

    // Store tracks and cars data globally
    window.adminTracksData = tracksData;
    window.adminCarsData = carsData;

    displayAdminInterface(lapsWithKeys, tracksData, carsData, emailLogsData);

  } catch (err) {
    console.error('loadAdminTools error', err);
  }
}


function displayRoundCards(setupData, roundData, tracksMap={}, carsMap={}) {
  const container = document.getElementById('round-cards-grid');
  container.innerHTML = '';

  if (!setupData || !setupData.length) {
    container.innerHTML = '<p style="text-align:center;padding:40px;color:#666;">No rounds configured yet. Use the form below to add your first round!</p>';
    return;
  }

  const fallbackTrackImage = 'https://static.vecteezy.com/system/resources/previews/015/114/628/non_2x/race-track-icon-isometric-road-circuit-vector.jpg';
  const fallbackCarImage = 'https://thumb.silhouette-ac.com/t/e9/e9f1eb16ae292f36be10def00d95ecbb_t.jpeg';

  const bySeasonRound = {};
  const byCombo = {};
  const rdArr = toArray(roundData);
  rdArr.forEach(r => {
    if (!r) return;
    const s = r.Season; const rn = r.Round;
    const key = `${s}-${rn}`;
    if (!bySeasonRound[key]) bySeasonRound[key] = [];
    bySeasonRound[key].push({ driver: r.Driver, totalTime: parseFloat(r['Total_Lap_Time']) || Infinity, round: rn, season: s, sector1: parseFloat(r['Sector_1'])||Infinity, sector2: parseFloat(r['Sector_2'])||Infinity, sector3: parseFloat(r['Sector_3'])||Infinity });

    const comboKey = `${r['Track-Layout'] || ''}||${r['Car_Name'] || ''}`;
    if (!byCombo[comboKey]) byCombo[comboKey] = [];
    byCombo[comboKey].push({ driver: r.Driver, totalTime: parseFloat(r['Total_Lap_Time']) || Infinity, round: rn, season: s, sector1: parseFloat(r['Sector_1'])||Infinity, sector2: parseFloat(r['Sector_2'])||Infinity, sector3: parseFloat(r['Sector_3'])||Infinity });
  });

  const frag = document.createDocumentFragment();
  setupData.sort((a,b) => a.season - b.season || a.round - b.round).forEach(setup => {
    const card = document.createElement('div'); card.className = 'round-card';
    const key = `${setup.season}-${setup.round}`;
    const roundTimes = bySeasonRound[key] || [];
    const comboTimes = byCombo[`${setup.trackLayout}||${setup.car}`] || [];

    const bestRoundTime = roundTimes.length ? roundTimes.reduce((p,c)=> c.totalTime < p.totalTime ? c : p) : null;
    const bestComboTime = comboTimes.length ? comboTimes.reduce((p,c)=> c.totalTime < p.totalTime ? c : p) : null;
    const bestSector1 = comboTimes.length ? comboTimes.reduce((p,c)=> c.sector1 < p.sector1 ? c : p) : null;
    const bestSector2 = comboTimes.length ? comboTimes.reduce((p,c)=> c.sector2 < p.sector2 ? c : p) : null;
    const bestSector3 = comboTimes.length ? comboTimes.reduce((p,c)=> c.sector3 < p.sector3 ? c : p) : null;

    const trackImage = tracksMap[setup.trackLayout] || fallbackTrackImage;
    const carImage = carsMap[setup.car] || fallbackCarImage;

    card.innerHTML = `
      <div class="round-card-header"><h3>Round ${setup.round}</h3><p class="season-number">${setup.season}</p></div>
      <div class="round-card-images">
        <div class="round-card-image-container"><img src="${trackImage}" alt="${setup.trackLayout}" onerror="this.src='${fallbackTrackImage}'"><p>${setup.trackLayout}</p></div>
        <div class="round-card-image-container"><img src="${carImage}" alt="${setup.car}" onerror="this.src='${fallbackCarImage}'"><p>${setup.car}</p></div>
      </div>
      <div class="round-card-body">
        ${bestRoundTime ? `<div class="best-time-section"><h4>🏆 This Round's Best</h4><div class="best-time-item gold"><div><div class="best-time-label">${getFormattedDriverName(bestRoundTime.driver)}</div><div class="best-time-context">Round ${setup.round} - Season ${setup.season}</div></div><div class="best-time-value">${formatTime(bestRoundTime.totalTime)}</div></div></div>` : `<div class="best-time-section"><p style="color:#999;">No lap times recorded yet</p></div>`}
        ${bestComboTime ? `<div class="best-time-section"><h4>⚡ All-Time Best (This Combo)</h4><div class="best-time-item"><div><div class="best-time-label">Lap: ${getFormattedDriverName(bestComboTime.driver)}</div><div class="best-time-context">Round ${bestComboTime.round}${bestComboTime.season ? ` - Season ${bestComboTime.season}` : ''}</div></div><div class="best-time-value">${formatTime(bestComboTime.totalTime)}</div></div>
          ${bestSector1 ? `<div class="best-time-item"><div><div class="best-time-label">S1: ${getFormattedDriverName(bestSector1.driver)}</div></div><div class="best-time-value">${formatTime(bestSector1.sector1)}</div></div>` : ''}
          ${bestSector2 ? `<div class="best-time-item"><div><div class="best-time-label">S2: ${getFormattedDriverName(bestSector2.driver)}</div></div><div class="best-time-value">${formatTime(bestSector2.sector2)}</div></div>` : ''}
          ${bestSector3 ? `<div class="best-time-item"><div><div class="best-time-label">S3: ${getFormattedDriverName(bestSector3.driver)}</div></div><div class="best-time-value">${formatTime(bestSector3.sector3)}</div></div>` : ''}
        </div>` : ''}
      </div>
    `;
    frag.appendChild(card);
  });

  container.appendChild(frag);
}

/* Driver Stats section continues in next file due to length... */
/* The rest remains the same as your original file from loadDriverStats onwards */
/* -----------------------------
   Driver Stats (CONTINUATION FROM PART 1)
   ----------------------------- */
async function loadDriverStats() {
  try {
    const [roundSnap, leaderboardSnap] = await Promise.all([
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Round_Data')),
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Leaderboard'))
    ]);
    const roundArr = toArray(roundSnap.val());
    const leaderboardArr = toArray(leaderboardSnap.val());

    const champSorted = leaderboardArr.slice().filter(l=>l && l.Driver).sort((a,b)=> (parseInt(b['Total_Points'])||0) - (parseInt(a['Total_Points'])||0));
    const champPos = {};
    champSorted.forEach((r,i)=> { if (r && r.Driver) champPos[r.Driver] = i+1; });

    const drivers = [...new Set((leaderboardArr.map(r=>r.Driver).filter(Boolean)).concat(roundArr.map(r=>r.Driver).filter(Boolean)))].filter(Boolean);

    const driversContent = document.getElementById('drivers-content');
    driversContent.innerHTML = '';
    const frag = document.createDocumentFragment();

    const roundsByDriver = {};
    roundArr.forEach(r => { if (!r || !r.Driver) return; if (!roundsByDriver[r.Driver]) roundsByDriver[r.Driver] = []; roundsByDriver[r.Driver].push(r); });

    drivers.forEach(driverName => {
      const driverRoundData = (roundsByDriver[driverName] || []);
      const driverLeaderboard = leaderboardArr.find(l => l.Driver === driverName) || {};
      const totalPoints = parseInt(driverLeaderboard['Total_Points']) || 0;
      const totalPurpleSectors = parseInt(driverLeaderboard['Total_Purple_Sectors']) || 0;
      const totalWins = parseInt(driverLeaderboard['Total_Wins']) || 0;
      const totalRounds = driverRoundData.length;
      const avgPosition = totalRounds > 0 ? (driverRoundData.reduce((s,r)=> s + (parseInt(r.Position)||0),0)/totalRounds).toFixed(1) : 'N/A';

      let personalBest = null;
      if (driverRoundData.length) {
        personalBest = driverRoundData.reduce((best,cur)=> {
          const c = parseFloat(cur['Total_Lap_Time']) || Infinity;
          const b = best ? parseFloat(best['Total_Lap_Time']) || Infinity : Infinity;
          return c < b ? cur : best;
        }, null);
      }

      const trackCarRecordsMap = {};
      driverRoundData.forEach(r => {
        const key = `${r['Track-Layout'] || ''} - ${r['Car_Name'] || ''}`;
        const t = parseFloat(r['Total_Lap_Time']) || Infinity;
        if (!trackCarRecordsMap[key] || t < trackCarRecordsMap[key].time) trackCarRecordsMap[key] = { combo: key, time: t, timeFormatted: formatTime(r['Total_Lap_Time']) };
      });
      const trackCarRecordsArray = Object.values(trackCarRecordsMap).sort((a,b)=>a.time-b.time);

      const trackCounts = {}; const carCounts = {};
      driverRoundData.forEach(r => { if (r['Track-Layout']) trackCounts[r['Track-Layout']] = (trackCounts[r['Track-Layout']]||0)+1; if (r['Car_Name']) carCounts[r['Car_Name']] = (carCounts[r['Car_Name']]||0)+1; });
      const favoriteTrack = Object.keys(trackCounts).sort((a,b)=>trackCounts[b]-trackCounts[a])[0] || 'N/A';
      const favoriteCar = Object.keys(carCounts).sort((a,b)=>carCounts[b]-carCounts[a])[0] || 'N/A';

      const positionsByRound = {};
      roundArr.forEach(r => {
        if (!r || !r.Round) return;
        const roundKey = `${r.Season}-${r.Round}`;
        if (!positionsByRound[roundKey]) positionsByRound[roundKey] = {};
        positionsByRound[roundKey][r.Driver] = parseInt(r.Position) || 999;
      });
      const opponents = [...new Set(roundArr.map(r=>r.Driver).filter(d=>d && d !== driverName))];
      const h2hRecords = {};
      opponents.forEach(op => {
        let wins = 0, losses = 0;
        Object.values(positionsByRound).forEach(roundMap => {
          if (roundMap[driverName] && roundMap[op]) {
            if (roundMap[driverName] < roundMap[op]) wins++; else if (roundMap[driverName] > roundMap[op]) losses++;
          }
        });
        if (wins || losses) h2hRecords[op] = { wins, losses };
      });

      const profileKey = encodeKey(driverName);
      const profile = DRIVER_PROFILES[profileKey] || {};

      let formattedName, formattedShortName;
      if (currentUser && profile && profile.surname) {
        formattedName = `${profile.name} ${profile.surname}`;
        formattedShortName = `${profile.name.charAt(0)}. ${profile.surname}`;
      } else if (!currentUser && profile && profile.surname) {
        formattedName = `${profile.name.charAt(0)}. ${profile.surname.charAt(0)}.`;
        formattedShortName = `${profile.name.charAt(0)}. ${profile.surname.charAt(0)}.`;
      } else {
        formattedName = driverName;
        formattedShortName = driverName;
      }
      
      const championshipPosition = champPos[driverName] || 'N/A';

      const card = document.createElement('div'); 
      card.className = 'driver-card'; 
      card.setAttribute('data-driver', driverName);
      
      let desktopPhotoHtml = '';
      let mobilePhotoHtml = '';
      
      if (currentUser) {
        desktopPhotoHtml = profile && profile.photoUrl 
          ? `<div class="driver-photo-container"><img src="${normalizePhotoUrl(profile.photoUrl)}" alt="${formattedName}" class="driver-photo"><div class="driver-number-badge">${profile.number||'?'}</div></div>` 
          : '';
        mobilePhotoHtml = profile && profile.photoUrl 
          ? `<div class="driver-photo-container-mobile"><img src="${normalizePhotoUrl(profile.photoUrl)}" alt="${formattedName}" class="driver-photo-mobile"><div class="driver-number-badge-mobile">${profile.number||'?'}</div></div>` 
          : '';
      } else {
        const driverNumber = profile && profile.number ? profile.number : '?';
        desktopPhotoHtml = `<div class="driver-number-placeholder">${driverNumber}</div>`;
        mobilePhotoHtml = `<div class="driver-number-placeholder-mobile">${driverNumber}</div>`;
      }

      const trackCarRecordsHtml = trackCarRecordsArray.length ? trackCarRecordsArray.map(r=> `<div class="record-item"><span>${r.combo}</span><strong>${r.timeFormatted}</strong></div>`).join('') : '<p style="color:#999;text-align:center">No records yet</p>';
      const h2hHtml = Object.entries(h2hRecords).length ? Object.entries(h2hRecords).map(([op,rec])=> `<div class="h2h-card"><div class="opponent">vs ${getFormattedDriverName(op, false)}</div><div class="record">${rec.wins}W - ${rec.losses}L</div></div>`).join('') : '<p style="color:#999;text-align:center">No head-to-head data yet</p>';

      // ============================================================================
      // FLIP CARD STRUCTURE - FRONT AND BACK
      // ============================================================================
      card.innerHTML = `
        <div class="driver-card-inner">
          <!-- ============ FRONT OF CARD ============ -->
          <div class="driver-card-front">
            <button class="flip-card-button" onclick="flipDriverCard(this)" title="View Equipment Setup">
              🎮
            </button>
            
            <div class="driver-header">${desktopPhotoHtml}<div class="driver-info"><h2>${formattedName}</h2><div class="driver-position">Championship Position: ${championshipPosition}</div></div></div>
            <div class="driver-header-mobile">${mobilePhotoHtml}<div class="driver-name-mobile">${formattedShortName}</div><div class="driver-stats-compact"><div class="stat-compact-item"><span class="stat-compact-label">Championship Position:</span><span class="stat-compact-value">${championshipPosition}</span></div><div class="stat-compact-row"><div class="stat-compact-item"><span class="stat-compact-label">Total Points:</span><span class="stat-compact-value">${totalPoints}</span></div><div class="stat-compact-item"><span class="stat-compact-label">Races:</span><span class="stat-compact-value">${totalRounds}</span></div></div></div></div>
            <div class="stats-grid-driver"><div class="stat-card-driver"><h3>Total Points</h3><p class="stat-value">${totalPoints}</p></div><div class="stat-card-driver"><h3>Wins</h3><p class="stat-value">${totalWins}</p></div><div class="stat-card-driver"><h3>Purple Sectors</h3><p class="stat-value">${totalPurpleSectors}</p></div><div class="stat-card-driver"><h3>Avg Position</h3><p class="stat-value">${avgPosition}</p></div></div>
            ${profile && profile.bio ? `<p style="text-align:center;color:#666;margin:20px 0;font-style:italic;">"${profile.bio}"</p>` : ''}
            <div class="driver-records-section"><h3 class="section-title">🏆 Lap Time Records</h3><div class="lap-records"><div class="personal-best"><strong style="color:#667eea;">Personal Best Lap:</strong><div style="font-size:1.5em;font-weight:bold;color:#2c3e50;margin:5px 0;">${personalBest ? formatTime(personalBest['Total_Lap_Time']) : 'N/A'}</div>${personalBest ? `<div style="font-size:0.9em;color:#666;">${personalBest['Track-Layout']}<br>${personalBest['Car_Name']}</div>` : ''}</div><div class="quick-stats"><div class="quick-stat-item"><strong style="color:#667eea;">Purple Sectors:</strong> ${totalPurpleSectors}</div><div class="quick-stat-item"><strong style="color:#667eea;">Favorite Track:</strong> ${favoriteTrack}</div><div class="quick-stat-item"><strong style="color:#667eea;">Favorite Car:</strong> ${favoriteCar}</div></div></div></div>
            <div class="driver-records-section"><h3 class="section-title">📍 Track + Car Records</h3><div class="track-car-records">${trackCarRecordsHtml}</div></div>
            <div class="driver-records-section"><h3 class="section-title">⚔️ Head-to-Head Record</h3><div class="h2h-grid">${h2hHtml}</div></div>
          </div>
          
          <!-- ============ BACK OF CARD ============ -->
          <div class="driver-card-back">
            <button class="flip-card-button flip-back" onclick="flipDriverCard(this)" title="Back to Stats">
              ↩
            </button>
            
            <div class="equipment-back-header">
              <h2>${formattedName}</h2>
              <h3>🎮 Equipment Setup</h3>
            </div>
            
            ${profile && profile.equipment && Object.values(profile.equipment).some(v => v) ? `
              <div class="equipment-grid-back">
                ${profile.equipment.wheel ? `
                  <div class="equipment-display-item-back">
                    ${profile.equipment.wheelImage ? `<img src="${normalizePhotoUrl(profile.equipment.wheelImage)}" alt="Wheel" onerror="this.style.display='none'">` : ''}
                    <div class="equipment-display-label">🎯 Wheel</div>
                    <div class="equipment-display-value">${profile.equipment.wheel}</div>
                  </div>
                ` : ''}
                ${profile.equipment.wheelbase ? `
                  <div class="equipment-display-item-back">
                    ${profile.equipment.wheelbaseImage ? `<img src="${normalizePhotoUrl(profile.equipment.wheelbaseImage)}" alt="Wheelbase" onerror="this.style.display='none'">` : ''}
                    <div class="equipment-display-label">⚙️ Wheelbase</div>
                    <div class="equipment-display-value">${profile.equipment.wheelbase}</div>
                  </div>
                ` : ''}
                ${profile.equipment.pedals ? `
                  <div class="equipment-display-item-back">
                    ${profile.equipment.pedalsImage ? `<img src="${normalizePhotoUrl(profile.equipment.pedalsImage)}" alt="Pedals" onerror="this.style.display='none'">` : ''}
                    <div class="equipment-display-label">🦶 Pedals</div>
                    <div class="equipment-display-value">${profile.equipment.pedals}</div>
                  </div>
                ` : ''}
                ${profile.equipment.shifter ? `
                  <div class="equipment-display-item-back">
                    ${profile.equipment.shifterImage ? `<img src="${normalizePhotoUrl(profile.equipment.shifterImage)}" alt="Shifter" onerror="this.style.display='none'">` : ''}
                    <div class="equipment-display-label">🔧 Shifter</div>
                    <div class="equipment-display-value">${profile.equipment.shifter}</div>
                  </div>
                ` : ''}
                ${profile.equipment.cockpit ? `
                  <div class="equipment-display-item-back">
                    ${profile.equipment.cockpitImage ? `<img src="${normalizePhotoUrl(profile.equipment.cockpitImage)}" alt="Cockpit" onerror="this.style.display='none'">` : ''}
                    <div class="equipment-display-label">🪑 Cockpit</div>
                    <div class="equipment-display-value">${profile.equipment.cockpit}</div>
                  </div>
                ` : ''}
                ${profile.equipment.seat ? `
                  <div class="equipment-display-item-back">
                    ${profile.equipment.seatImage ? `<img src="${normalizePhotoUrl(profile.equipment.seatImage)}" alt="Seat" onerror="this.style.display='none'">` : ''}
                    <div class="equipment-display-label">💺 Seat</div>
                    <div class="equipment-display-value">${profile.equipment.seat}</div>
                  </div>
                ` : ''}
                ${profile.equipment.other ? `
                  <div class="equipment-display-item-back full-width">
                    ${profile.equipment.otherImage ? `<img src="${normalizePhotoUrl(profile.equipment.otherImage)}" alt="Other" onerror="this.style.display='none'">` : ''}
                    <div class="equipment-display-label">🎧 Other</div>
                    <div class="equipment-display-value">${profile.equipment.other}</div>
                  </div>
                ` : ''}
              </div>
            ` : `
              <div class="equipment-empty-state">
                <p style="font-size: 48px; margin: 20px 0;">🎮</p>
                <p style="color: #999; font-size: 16px;">No equipment information available</p>
                <p style="color: #ccc; font-size: 14px; margin-top: 10px;">Driver can add equipment details in their profile</p>
              </div>
            `}
          </div>
        </div>
      `;

      frag.appendChild(card);
    });

    driversContent.appendChild(frag);
    document.getElementById('drivers-loading').style.display = 'none';
    document.getElementById('drivers-content').style.display = 'block';

  } catch (err) {
    console.error('loadDriverStats error', err);
    document.getElementById('drivers-loading').innerHTML = '<p style="color:red;">Error loading driver statistics</p>';
  }
}

/* -----------------------------
   Profile: load & save (by username key)
   ----------------------------- */
async function loadProfile() {
  const profileContent = document.getElementById('profileContent');
  const profileWarning = document.getElementById('profileAuthWarning');
  if (!currentUser) { 
    profileWarning.style.display = 'block'; 
    profileContent.style.display = 'none'; 
    return; 
  }
  profileWarning.style.display = 'none'; 
  profileContent.style.display = 'block';

  const profile = DRIVER_PROFILES[encodeKey(currentUser.name)] || {};
  
  // Load basic profile
  document.getElementById('profileName').value = profile.name || '';
  document.getElementById('profileSurname').value = profile.surname || '';
  document.getElementById('profileNumber').value = profile.number || '';
  document.getElementById('profilePhotoUrl').value = profile.photoUrl || '';
  document.getElementById('profileBio').value = profile.bio || '';

  if (profile.photoUrl) {
    document.getElementById('photoPreviewImg').src = normalizePhotoUrl(profile.photoUrl);
    document.getElementById('photoPreview').style.display = 'block';
  }
  
  // Load equipment data (NEW)
  const equipment = profile.equipment || {};
  document.getElementById('equipWheel').value = equipment.wheel || '';
  document.getElementById('equipWheelImage').value = equipment.wheelImage || '';
  document.getElementById('equipWheelbase').value = equipment.wheelbase || '';
  document.getElementById('equipWheelbaseImage').value = equipment.wheelbaseImage || '';
  document.getElementById('equipPedals').value = equipment.pedals || '';
  document.getElementById('equipPedalsImage').value = equipment.pedalsImage || '';
  document.getElementById('equipShifter').value = equipment.shifter || '';
  document.getElementById('equipShifterImage').value = equipment.shifterImage || '';
  document.getElementById('equipCockpit').value = equipment.cockpit || '';
  document.getElementById('equipCockpitImage').value = equipment.cockpitImage || '';
  document.getElementById('equipSeat').value = equipment.seat || '';
  document.getElementById('equipSeatImage').value = equipment.seatImage || '';
  document.getElementById('equipOther').value = equipment.other || '';
  document.getElementById('equipOtherImage').value = equipment.otherImage || '';
  
  // Show image previews if URLs exist (NEW)
  if (equipment.wheelImage) showEquipmentPreview('wheel', equipment.wheelImage);
  if (equipment.wheelbaseImage) showEquipmentPreview('wheelbase', equipment.wheelbaseImage);
  if (equipment.pedalsImage) showEquipmentPreview('pedals', equipment.pedalsImage);
  if (equipment.shifterImage) showEquipmentPreview('shifter', equipment.shifterImage);
  if (equipment.cockpitImage) showEquipmentPreview('cockpit', equipment.cockpitImage);
  if (equipment.seatImage) showEquipmentPreview('seat', equipment.seatImage);
  if (equipment.otherImage) showEquipmentPreview('other', equipment.otherImage);
  
  // Load email preferences
  setTimeout(() => loadEmailPreferences(), 100);
}

document.getElementById('profileForm')?.addEventListener('submit', async function(e){
  e.preventDefault();
  if (!currentUser) { alert('Please sign in to update your profile'); return; }
  
  const messageDiv = document.getElementById('profileMessage'); 
  messageDiv.style.display = 'block'; 
  messageDiv.textContent = '⏳ Saving profile...';

  try {
    const profileData = {
      Name: document.getElementById('profileName').value.trim(),
      Surname: document.getElementById('profileSurname').value.trim(),
      Number: parseInt(document.getElementById('profileNumber').value),
      Photo_URL: document.getElementById('profilePhotoUrl').value.trim(),
      Bio: document.getElementById('profileBio').value.trim(),
      // NEW: Equipment data
      equipment: {
        wheel: document.getElementById('equipWheel').value.trim(),
        wheelImage: document.getElementById('equipWheelImage').value.trim(),
        wheelbase: document.getElementById('equipWheelbase').value.trim(),
        wheelbaseImage: document.getElementById('equipWheelbaseImage').value.trim(),
        pedals: document.getElementById('equipPedals').value.trim(),
        pedalsImage: document.getElementById('equipPedalsImage').value.trim(),
        shifter: document.getElementById('equipShifter').value.trim(),
        shifterImage: document.getElementById('equipShifterImage').value.trim(),
        cockpit: document.getElementById('equipCockpit').value.trim(),
        cockpitImage: document.getElementById('equipCockpitImage').value.trim(),
        seat: document.getElementById('equipSeat').value.trim(),
        seatImage: document.getElementById('equipSeatImage').value.trim(),
        other: document.getElementById('equipOther').value.trim(),
        otherImage: document.getElementById('equipOtherImage').value.trim()
      }
    };
    
    // Get email preferences
    const emailPrefs = {
      newRound: document.getElementById('email-newRound').checked,
      fastestLap: document.getElementById('email-fastestLap').checked,
      weeklyResults: document.getElementById('email-weeklyResults').checked
    };

    const usernameKey = encodeKey(currentUser.name);
    const arrayIndex = DRIVER_PROFILE_INDICES[usernameKey];
    
    let profileRef;
    
    if (arrayIndex !== undefined) {
      profileRef = window.firebaseRef(window.firebaseDB, `Driver_Profiles/${arrayIndex}`);
      const existingSnapshot = await window.firebaseGet(profileRef);
      const existingProfile = existingSnapshot.val() || {};
      
      await window.firebaseSet(profileRef, {
        Name: profileData.Name,
        Surname: profileData.Surname,
        Number: profileData.Number,
        Photo_URL: profileData.Photo_URL,
        Bio: profileData.Bio,
        Email: existingProfile.Email || '',
        emailNotifications: emailPrefs,
        equipment: profileData.equipment // NEW
      });
    } else {
      profileRef = window.firebaseRef(window.firebaseDB, `Driver_Profiles/${usernameKey}`);
      await window.firebaseSet(profileRef, {
        Name: profileData.Name,
        Surname: profileData.Surname,
        Number: profileData.Number,
        Photo_URL: profileData.Photo_URL,
        Bio: profileData.Bio,
        emailNotifications: emailPrefs,
        equipment: profileData.equipment // NEW
      });
    }

    DRIVER_PROFILES[usernameKey] = {
      name: profileData.Name,
      surname: profileData.Surname,
      number: String(profileData.Number),
      photoUrl: profileData.Photo_URL,
      bio: profileData.Bio,
      equipment: profileData.equipment // NEW
    };

    messageDiv.style.background='#d4edda'; 
    messageDiv.style.color='#155724'; 
    messageDiv.textContent='✅ Profile saved!';
    
    setTimeout(() => {
      messageDiv.style.display = 'none';
      const profile = DRIVER_PROFILES[usernameKey];
      const photoContainer = document.getElementById('userPhotoContainer');
      const photoElement = document.getElementById('userProfilePhoto');
      const numberBadge = document.getElementById('userNumberBadge');
      const iconFallback = document.getElementById('userIconFallback');
      if (profile && profile.photoUrl) {
        photoElement.src = normalizePhotoUrl(profile.photoUrl);
        numberBadge.textContent = profile.number || '?';
        photoContainer.style.display = 'block';
        iconFallback.style.display = 'none';
      }
    }, 2000);

  } catch (err) {
    console.error('profile save error', err);
    messageDiv.style.background='#f8d7da'; 
    messageDiv.style.color='#721c24'; 
    messageDiv.textContent='❌ ' + err.message;
  }
});

document.getElementById('photoFile')?.addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Please select an image file'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('photoPreviewImg').src = e.target.result;
    document.getElementById('photoPreview').style.display = 'block';
    alert('⚠️ Photo upload to storage not yet implemented. Please upload to Google Drive and paste the sharing link in the Photo URL field.');
  };
  reader.readAsDataURL(file);
});

function showEquipmentPreview(equipmentType, imageUrl) {
  const previewImg = document.getElementById(`equipPreview_${equipmentType}_img`);
  const previewContainer = document.getElementById(`equipPreview_${equipmentType}`);
  
  if (previewImg && previewContainer && imageUrl) {
    previewImg.src = normalizePhotoUrl(imageUrl);
    previewContainer.style.display = 'block';
  }
}

/* -----------------------------
   Lap Time Submission (with form reset!)
   ----------------------------- */
function disableButton(btn, disabled) {
  if (!btn) return;
  btn.disabled = disabled;
  btn.style.opacity = disabled ? '0.5' : '1';
  btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
}

document.getElementById('lapTimeForm')?.addEventListener('submit', async function(e){
  e.preventDefault();
  if (!currentUser) { alert('⚠️ Please sign in first'); return; }

  const submitBtn = this.querySelector('button[type="submit"]');
  const messageDiv = document.getElementById('lapTimeMessage');
  disableButton(submitBtn, true);
  messageDiv.style.display='block'; messageDiv.style.background='#d1ecf1'; messageDiv.style.color='#0c5460'; messageDiv.textContent='⏳ Submitting...';

  try {
    const s1sec = document.getElementById('sector1-sec').value.trim();
    const s1ms = document.getElementById('sector1-ms').value.trim();
    const s2sec = document.getElementById('sector2-sec').value.trim();
    const s2ms = document.getElementById('sector2-ms').value.trim();
    const s3sec = document.getElementById('sector3-sec').value.trim();
    const s3ms = document.getElementById('sector3-ms').value.trim();

    if (!s1sec || !s1ms || !s2sec || !s2ms || !s3sec || !s3ms) throw new Error('Please fill all sector time fields');

    const s1 = parseFloat(s1sec) + parseFloat(s1ms)/1000;
    const s2 = parseFloat(s2sec) + parseFloat(s2ms)/1000;
    const s3 = parseFloat(s3sec) + parseFloat(s3ms)/1000;
    const totalTime = s1 + s2 + s3;

    const roundNumber = parseInt(document.getElementById('roundNumber2').value);
    const seasonNumber = parseInt(document.getElementById('seasonNumber').value);
    if (!roundNumber || !seasonNumber) throw new Error('Please select both round and season');

    if (!CACHE.setupArray) {
      const setupSnap = await window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Form_responses_2'));
      CACHE.setupArray = toArray(setupSnap.val());
    }
    const roundSetup = CACHE.setupArray.find(s => s && Number(s.Round_Number) == roundNumber && Number(s.Season) == seasonNumber);
    if (!roundSetup) throw new Error(`Round ${roundNumber} Season ${seasonNumber} not configured!`);

    const lapTimeData = {
      Timestamp: new Date().toISOString(),
      Driver: currentUser.name,
      Season: seasonNumber,
      Round: roundNumber,
      Sector_1: s1,
      Sector_2: s2,
      Sector_3: s3,
      Total_Lap_Time: totalTime,
      'Track-Layout': roundSetup['Track-Layout'],
      Car_Name: roundSetup.Car_Name
    };

    await window.firebasePush(window.firebaseRef(window.firebaseDB, 'Form_responses_1'), lapTimeData);
    messageDiv.style.background='#d4edda'; messageDiv.style.color='#155724'; messageDiv.textContent='✅ Lap time submitted! Server is calculating...';

    document.getElementById('lapTimeForm').reset();

    CACHE.roundDataArray = null;
    await wait(2000);
    loadLeaderboard();
    loadRoundData();

    setTimeout(()=> { messageDiv.style.display='none'; }, 4500);
  } catch (err) {
    console.error('lap submit err', err);
    messageDiv.style.background='#f8d7da'; messageDiv.style.color='#721c24'; messageDiv.textContent='❌ ' + err.message;
  } finally {
    disableButton(submitBtn, false);
  }
});

/* -----------------------------
   Login / Session handling
   ----------------------------- */
function getFormattedDriverName(driverLoginName, includeNumber = true) {
  const profile = DRIVER_PROFILES[encodeKey(driverLoginName)];
  
  if (currentUser && profile && profile.surname && profile.name) {
    const number = profile.number || '?';
    return includeNumber 
      ? `${profile.name.charAt(0)}. ${profile.surname} - ${number}`
      : `${profile.name.charAt(0)}. ${profile.surname}`;
  }
  
  if (!currentUser && profile && profile.surname && profile.name) {
    return `${profile.name.charAt(0)}. ${profile.surname.charAt(0)}.`;
  }
  
  return driverLoginName;
}

// Add this function to script.js:

function flipDriverCard(button) {
  const card = button.closest('.driver-card');
  if (card) {
    card.classList.toggle('flipped');
  }
}

function login() {
  const driverName = document.getElementById('driverNameInput')?.value.trim();
  const password = document.getElementById('passwordInput')?.value;
  if (!driverName || !password) { alert('⚠️ Please enter both driver name and password.'); return; }
  if (!ALLOWED_USERS[driverName]) { alert(`⛔ Access Denied\n\nDriver name "${driverName}" is not authorized.`); return; }
  const storedPassword = ALLOWED_USERS[driverName].password;
  if (password !== storedPassword) { alert('⛔ Incorrect password.'); return; }

  currentUser = { name: driverName, email: ALLOWED_USERS[driverName].email || '' };
  sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
  applyUserUI();
}

function signOut() {
  currentUser = null;
  sessionStorage.removeItem('currentUser');
  applyUserUI();
}

function applyUserUI() {
  const loginForm = document.getElementById('loginForm');
  const userInfo = document.getElementById('userInfo');
  if (currentUser) {
    if (loginForm) loginForm.style.display = 'none';
    if (userInfo) userInfo.style.display = 'block';
    document.getElementById('userName').textContent = currentUser.name;

    const profile = DRIVER_PROFILES[encodeKey(currentUser.name)];
    const photoContainer = document.getElementById('userPhotoContainer');
    const photoElement = document.getElementById('userProfilePhoto');
    const numberBadge = document.getElementById('userNumberBadge');
    const iconFallback = document.getElementById('userIconFallback');

    if (profile && profile.photoUrl) {
      photoElement.src = normalizePhotoUrl(profile.photoUrl);
      numberBadge.textContent = profile.number || '?';
      photoContainer.style.display = 'block';
      iconFallback.style.display = 'none';
    } else {
      photoContainer.style.display = 'none';
      iconFallback.style.display = 'block';
    }
  } else {
    if (loginForm) loginForm.style.display = 'flex';
    if (userInfo) userInfo.style.display = 'none';
    document.getElementById('driverNameInput').value = '';
    document.getElementById('passwordInput').value = '';
  }
  updateSubmitTabVisibility();
  updateAdminTabVisibility();
}

function updateSubmitTabVisibility() {
  const submitTab = document.querySelector('.tab-button[onclick*="submit"]');
  const setupTab = document.querySelector('.tab-button[onclick*="setup"]');
  const authWarning = document.getElementById('authWarning');
  const lapTimeFormContainer = document.getElementById('lapTimeFormContainer');
  
  if (currentUser) { 
    if (submitTab) submitTab.style.display = ''; 
    if (setupTab) setupTab.style.display = ''; 
    if (authWarning) authWarning.style.display = 'none'; 
    if (lapTimeFormContainer) {
      lapTimeFormContainer.style.display = 'block';
      // Setup dynamic total time preview
      setTimeout(() => setupTotalTimePreview(), 100);
    }
  } else { 
    if (submitTab) submitTab.style.display = 'none'; 
    if (setupTab) setupTab.style.display = 'none'; 
    if (authWarning) authWarning.style.display = 'block'; 
    if (lapTimeFormContainer) lapTimeFormContainer.style.display = 'none'; 
  }
}

async function checkExistingSession() {
  const stored = sessionStorage.getItem('currentUser');
  if (!stored) {
    updateSubmitTabVisibility();
    return;
  }
  currentUser = JSON.parse(stored);
  await waitFor(()=> Object.keys(DRIVER_PROFILES).length > 0, 2000);
  applyUserUI();
}

/* -----------------------------
   Small utilities & init
   ----------------------------- */
function wait(ms) { return new Promise(res => setTimeout(res, ms)); }
function waitFor(predicate, timeout = 3000) {
  return new Promise(resolve => {
    const start = Date.now();
    const id = setInterval(()=> {
      if (predicate()) { clearInterval(id); resolve(true); }
      else if (Date.now() - start > timeout) { clearInterval(id); resolve(false); }
    }, 80);
  });
}

/* -----------------------------
   Basic DOM helpers (sector inputs etc.)
   ----------------------------- */
function setupSectorTimeInputs() {
  const sectorInputs = document.querySelectorAll('.time-input-split-field');
  sectorInputs.forEach(input => {
    input.addEventListener('input', function(e) {
      const maxLen = parseInt(this.getAttribute('maxlength'));
      if (this.value.length >= maxLen) {
        const nextInput = this.nextElementSibling?.nextElementSibling;
        if (nextInput && nextInput.classList.contains('time-input-split-field')) nextInput.focus();
      }
    });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && this.value.length === 0) {
        const prevInput = this.previousElementSibling?.previousElementSibling;
        if (prevInput && prevInput.classList.contains('time-input-split-field')) {
          prevInput.focus();
          prevInput.setSelectionRange(prevInput.value.length, prevInput.value.length);
        }
      }
    });
  });
}

function handleResponsiveUI() {
  const desktopLogo = document.getElementById('desktopLogo');
  const mobileLogo = document.getElementById('mobileLogo');
  if (window.innerWidth <= 480) {
    if (desktopLogo) desktopLogo.style.display = 'none';
    if (mobileLogo) mobileLogo.style.display = 'block';
  } else {
    if (desktopLogo) desktopLogo.style.display = 'block';
    if (mobileLogo) mobileLogo.style.display = 'none';
  }
}

window.addEventListener('resize', handleResponsiveUI);

document.addEventListener('DOMContentLoaded', function() {
  updateSubmitTabVisibility();
  handleResponsiveUI();
  
  const passwordInput = document.getElementById('passwordInput');
  const driverNameInput = document.getElementById('driverNameInput');
  
  if (passwordInput) {
    passwordInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') login();
    });
  }
  
  if (driverNameInput) {
    driverNameInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') login();
    });
  }

  if (window.innerWidth <= 480) {
    const leaderboardBody = document.getElementById('leaderboard-body');
    if (leaderboardBody) {
      leaderboardBody.addEventListener('click', function(e) {
        const row = e.target.closest('tr');
        if (row) {
          const driverLink = row.querySelector('.driver-link');
          if (driverLink) {
            const driverName = driverLink.getAttribute('data-driver');
            goToDriverCurrentRound(driverName);
          }
        }
      });
    }
  }
});

// Add these global variables at the top with your other admin globals
//let currentAdminTab = 'time-submissions';

/*
async function loadAdminTools() {
  if (!isAdmin()) {
    document.getElementById('admin-content').innerHTML = '<p style="text-align:center;padding:40px;color:#666;">Access Denied</p>';
    return;
  }

  try {
    const [lapsSnapshot, tracksSnapshot, carsSnapshot, emailLogsSnapshot] = await Promise.all([
     window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Form_responses_1')),
     window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Tracks')),
     window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Cars')),
     window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Email_Logs'))
   ]);

     const emailLogsData = [];
   const emailLogsObject = emailLogsSnapshot.val();
   if (emailLogsObject && typeof emailLogsObject === 'object') {
     Object.entries(emailLogsObject).forEach(([key, value]) => {
       emailLogsData.push({ id: key, ...value });
     });
   }
    
    const lapsData = toArray(lapsSnapshot.val());
    const tracksData = toArray(tracksSnapshot.val());
    const carsData = toArray(carsSnapshot.val());
    
    const lapsWithKeys = [];
    const lapsObject = lapsSnapshot.val();
    if (lapsObject && typeof lapsObject === 'object') {
      Object.keys(lapsObject).forEach(key => {
        if (lapsObject[key]) {
          lapsWithKeys.push({ ...lapsObject[key], _firebaseKey: key });
        }
      });
    }

    // Store tracks and cars data globally
    window.adminTracksData = tracksData;
    window.adminCarsData = carsData;

    displayAdminInterface(lapsWithKeys, tracksData, carsData, emailLogsData);

  } catch (err) {
    console.error('loadAdminTools error', err);
  }
}
*/

/*
function displayAdminInterface(lapsData, tracksData, carsData, emailLogsData) {
  const container = document.getElementById('admin-lap-times-table');
  if (!container) return;

// Admin tabs navigation
const tabsHtml = `
  <div class="admin-tabs">
    <button class="admin-tab-button ${currentAdminTab === 'time-submissions' ? 'active' : ''}" onclick="switchAdminTab('time-submissions')">
      ⏱️ Time Submissions
    </button>
    <button class="admin-tab-button ${currentAdminTab === 'tracks-config' ? 'active' : ''}" onclick="switchAdminTab('tracks-config')">
      🏁 Tracks Config
    </button>
    <button class="admin-tab-button ${currentAdminTab === 'cars-config' ? 'active' : ''}" onclick="switchAdminTab('cars-config')">
      🏎️ Cars Config
    </button>
    <button class="admin-tab-button ${currentAdminTab === 'email-logs' ? 'active' : ''}" onclick="switchAdminTab('email-logs')">
     📧 Email Logs
    </button>
  </div>
`;

  let contentHtml = '';

  if (currentAdminTab === 'time-submissions') {
     contentHtml = generateTimeSubmissionsContent(lapsData);
   } else if (currentAdminTab === 'tracks-config') {
     contentHtml = generateTracksConfigContent(tracksData);
   } else if (currentAdminTab === 'cars-config') {
     contentHtml = generateCarsConfigContent(carsData);
   } else if (currentAdminTab === 'email-logs') {
     contentHtml = generateEmailLogsContent(emailLogsData);
   }

  container.innerHTML = tabsHtml + contentHtml;

  window.adminLapsData = lapsData;
  
  // Reapply filters if on time submissions tab
  if (currentAdminTab === 'time-submissions' && (currentAdminFilters.driver || currentAdminFilters.season || currentAdminFilters.round)) {
    filterAdminLaps();
  }
}
*/

function switchAdminTab(tabName) {
  currentAdminTab = tabName;
  loadAdminTools();
}

function generateTimeSubmissionsContent(lapsData) {
  const drivers = [...new Set(lapsData.map(l => l.Driver).filter(Boolean))].sort();
  const seasons = [...new Set(lapsData.map(l => l.Season).filter(Boolean))].sort((a,b) => b-a);
  const rounds = [...new Set(lapsData.map(l => l.Round).filter(Boolean))].sort((a,b) => a-b);

  const subBannerHtml = `
    <div class="admin-sub-banner">
      <h3>⏱️ Time Submissions</h3>
      <p>View, edit, and manage all lap time submissions</p>
    </div>
  `;

  const filterHtml = `
    <div class="admin-filters">
      <select id="adminFilterDriver" class="admin-filter-select" onchange="filterAdminLaps()">
        <option value="">All Drivers</option>
        ${drivers.map(d => `<option value="${d}" ${currentAdminFilters.driver === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <select id="adminFilterSeason" class="admin-filter-select" onchange="filterAdminLaps()">
        <option value="">All Seasons</option>
        ${seasons.map(s => `<option value="${s}" ${String(currentAdminFilters.season) === String(s) ? 'selected' : ''}>Season ${s}</option>`).join('')}
      </select>
      <select id="adminFilterRound" class="admin-filter-select" onchange="filterAdminLaps()">
        <option value="">All Rounds</option>
        ${rounds.map(r => `<option value="${r}" ${String(currentAdminFilters.round) === String(r) ? 'selected' : ''}>Round ${r}</option>`).join('')}
      </select>
      <button onclick="clearAdminFilters()" class="admin-filter-btn">Clear Filters</button>
    </div>
  `;

  lapsData.sort((a, b) => {
    const timeA = new Date(a.Timestamp).getTime();
    const timeB = new Date(b.Timestamp).getTime();
    return timeB - timeA;
  });

  const tableHtml = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Driver</th>
          <th>Season</th>
          <th>Round</th>
          <th>Sector 1</th>
          <th>Sector 2</th>
          <th>Sector 3</th>
          <th onclick="sortAdminByTotalTime()" style="cursor:pointer;" title="Click to sort">
            Total Time <span id="sortIndicator">⇅</span>
          </th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="adminLapsTableBody">
        ${lapsData.map(lap => createAdminLapRow(lap)).join('')}
      </tbody>
    </table>
  `;

  return subBannerHtml + filterHtml + tableHtml;
}

function generateTracksConfigContent(tracksData) {
  const subBannerHtml = `
    <div class="admin-sub-banner">
      <h3>🏁 Tracks Configuration</h3>
      <p>Manage track layouts and images</p>
    </div>
  `;

  const searchHtml = `
    <div class="admin-search-bar">
      <input type="text" 
             id="trackSearchInput" 
             placeholder="🔍 Search tracks..." 
             class="admin-search-input"
             oninput="filterTracksTable()" />
    </div>
  `;

  const addNewHtml = `
    <div class="admin-add-new">
      <h4>➕ Add New Track</h4>
      <div class="admin-form-inline">
        <input type="text" id="newTrackCombo" placeholder="Track & Layout (e.g., Silverstone - GP)" class="admin-input" />
        <input type="text" id="newTrackImageUrl" placeholder="Image URL" class="admin-input" />
        <button onclick="addNewTrack()" class="admin-btn-save">Add Track</button>
      </div>
    </div>
  `;

  const tableHtml = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Track & Layout</th>
          <th>Image URL</th>
          <th>Preview</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="tracksTableBody">
        ${tracksData.map((track, idx) => `
          <tr data-track-name="${(track.Track_Combos || '').toLowerCase()}">
            <td data-label="Track & Layout">${track.Track_Combos || ''}</td>
            <td data-label="Image URL">
              <input type="text" 
                     id="trackUrl-${idx}" 
                     value="${track.Track_Image_URL || ''}" 
                     class="admin-input-inline" 
                     style="width: 100%; max-width: 400px;" />
            </td>
            <td data-label="Preview">
              ${track.Track_Image_URL ? `<img src="${track.Track_Image_URL}" style="width: 60px; height: 40px; object-fit: cover; border-radius: 4px;" onerror="this.style.display='none'">` : 'No image'}
            </td>
            <td data-label="Actions">
              <button onclick="updateTrack(${idx})" class="admin-btn-edit">💾 Save</button>
              <button onclick="deleteTrack(${idx})" class="admin-btn-delete">🗑️ Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  return subBannerHtml + searchHtml + addNewHtml + tableHtml;
}

function generateCarsConfigContent(carsData) {
  const subBannerHtml = `
    <div class="admin-sub-banner">
      <h3>🏎️ Cars Configuration</h3>
      <p>Manage car names and images</p>
    </div>
  `;

  const searchHtml = `
    <div class="admin-search-bar">
      <input type="text" 
             id="carSearchInput" 
             placeholder="🔍 Search cars..." 
             class="admin-search-input"
             oninput="filterCarsTable()" />
    </div>
  `;

  const addNewHtml = `
    <div class="admin-add-new">
      <h4>➕ Add New Car</h4>
      <div class="admin-form-inline">
        <input type="text" id="newCarName" placeholder="Car Name (e.g., Formula Pro Gen 2)" class="admin-input" />
        <input type="text" id="newCarImageUrl" placeholder="Image URL" class="admin-input" />
        <button onclick="addNewCar()" class="admin-btn-save">Add Car</button>
      </div>
    </div>
  `;

  const tableHtml = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Car Name</th>
          <th>Image URL</th>
          <th>Preview</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="carsTableBody">
        ${carsData.map((car, idx) => `
          <tr data-car-name="${(car.Car_Name || '').toLowerCase()}">
            <td data-label="Car Name">${car.Car_Name || ''}</td>
            <td data-label="Image URL">
              <input type="text" 
                     id="carUrl-${idx}" 
                     value="${car.Car_Image_URL || ''}" 
                     class="admin-input-inline" 
                     style="width: 100%; max-width: 400px;" />
            </td>
            <td data-label="Preview">
              ${car.Car_Image_URL ? `<img src="${car.Car_Image_URL}" style="width: 60px; height: 40px; object-fit: cover; border-radius: 4px;" onerror="this.style.display='none'">` : 'No image'}
            </td>
            <td data-label="Actions">
              <button onclick="updateCar(${idx})" class="admin-btn-edit">💾 Save</button>
              <button onclick="deleteCar(${idx})" class="admin-btn-delete">🗑️ Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  return subBannerHtml + searchHtml + addNewHtml + tableHtml;
}

function generateEmailLogsContent(emailLogsData) {
  const subBannerHtml = `
    <div class="admin-sub-banner">
      <h3>📧 Email Logs & Controls</h3>
      <p>Monitor email notifications and manage settings</p>
    </div>
  `;

  // EMAIL TOGGLE SECTION (now inside Email Logs tab)
  const emailToggleHtml = `
    <div class="admin-email-toggle-section">
      <div class="admin-email-toggle-card">
        <div class="admin-email-toggle-header">
          <h3>📧 Email Notifications Control</h3>
        </div>
        <div class="admin-email-toggle-body">
          <p class="admin-email-description">Control email notifications by type. Individual user preferences will be preserved when notifications are re-enabled.</p>
          
          <!-- Master Toggle -->
          <div class="admin-email-master-toggle">
            <div class="admin-email-toggle-row master">
              <div class="admin-email-toggle-info">
                <span class="admin-email-toggle-icon">🎛️</span>
                <div class="admin-email-toggle-text">
                  <strong>Master Control</strong>
                  <span class="admin-email-toggle-desc">Enable/disable all email types at once</span>
                </div>
              </div>
              <label class="admin-toggle-switch">
                <input type="checkbox" id="emailToggleMaster" onchange="toggleAllEmails()" checked>
                <span class="admin-toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="admin-email-divider"></div>

          <!-- Individual Email Type Toggles -->
          <div class="admin-email-types-grid">
            
            <!-- New Round Notifications -->
            <div class="admin-email-type-card">
              <div class="admin-email-type-header">
                <span class="admin-email-type-icon">🏁</span>
                <div class="admin-email-type-title">
                  <h4>New Round</h4>
                  <span class="admin-email-status-badge active" id="emailStatus_newRound">ACTIVE</span>
                </div>
              </div>
              <p class="admin-email-type-desc">Sent when a new round is configured and ready</p>
              <div class="admin-email-toggle-row">
                <span class="admin-email-toggle-label">Enable Notifications</span>
                <label class="admin-toggle-switch">
                  <input type="checkbox" id="emailToggle_newRound" onchange="toggleEmailType('newRound')" checked>
                  <span class="admin-toggle-slider"></span>
                </label>
              </div>
            </div>

            <!-- Fastest Lap Notifications -->
            <div class="admin-email-type-card">
              <div class="admin-email-type-header">
                <span class="admin-email-type-icon">⚡</span>
                <div class="admin-email-type-title">
                  <h4>Fastest Lap</h4>
                  <span class="admin-email-status-badge active" id="emailStatus_fastestLap">ACTIVE</span>
                </div>
              </div>
              <p class="admin-email-type-desc">Sent when a new fastest lap is recorded</p>
              <div class="admin-email-toggle-row">
                <span class="admin-email-toggle-label">Enable Notifications</span>
                <label class="admin-toggle-switch">
                  <input type="checkbox" id="emailToggle_fastestLap" onchange="toggleEmailType('fastestLap')" checked>
                  <span class="admin-toggle-slider"></span>
                </label>
              </div>
            </div>

            <!-- Weekly Results Notifications -->
            <div class="admin-email-type-card">
              <div class="admin-email-type-header">
                <span class="admin-email-type-icon">🏆</span>
                <div class="admin-email-type-title">
                  <h4>Weekly Results</h4>
                  <span class="admin-email-status-badge active" id="emailStatus_weeklyResults">ACTIVE</span>
                </div>
              </div>
              <p class="admin-email-type-desc">Sent every Monday with round results</p>
              <div class="admin-email-toggle-row">
                <span class="admin-email-toggle-label">Enable Notifications</span>
                <label class="admin-toggle-switch">
                  <input type="checkbox" id="emailToggle_weeklyResults" onchange="toggleEmailType('weeklyResults')" checked>
                  <span class="admin-toggle-slider"></span>
                </label>
              </div>
            </div>

          </div>

          <div id="emailToggleGlobalStatus" class="admin-status-message" style="display: none;"></div>
          
        </div>
      </div>
    </div>
  `;

  // Calculate stats
  const totalEmails = emailLogsData.length;
  const sentEmails = emailLogsData.filter(log => log.status === 'sent').length;
  const failedEmails = emailLogsData.filter(log => log.status === 'failed').length;
  const skippedEmails = emailLogsData.filter(log => log.status === 'skipped').length;

  const statsHtml = `
    <div class="admin-email-stats">
      <div class="admin-stat-card">
        <div class="admin-stat-number">${totalEmails}</div>
        <div class="admin-stat-label">Total Emails</div>
      </div>
      <div class="admin-stat-card admin-stat-success">
        <div class="admin-stat-number">${sentEmails}</div>
        <div class="admin-stat-label">Sent Successfully</div>
      </div>
      <div class="admin-stat-card admin-stat-warning">
        <div class="admin-stat-number">${skippedEmails}</div>
        <div class="admin-stat-label">Skipped (Paused)</div>
      </div>
      <div class="admin-stat-card admin-stat-failed">
        <div class="admin-stat-number">${failedEmails}</div>
        <div class="admin-stat-label">Failed</div>
      </div>
    </div>
  `;

  // Get unique types for filter
  const types = [...new Set(emailLogsData.map(l => l.type).filter(Boolean))];

  const filterHtml = `
    <div class="admin-filters">
      <select id="emailTypeFilter" class="admin-filter-select" onchange="filterEmailLogs()">
        <option value="">All Types</option>
        ${types.map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <select id="emailStatusFilter" class="admin-filter-select" onchange="filterEmailLogs()">
        <option value="">All Status</option>
        <option value="sent">Sent</option>
        <option value="skipped">Skipped</option>
        <option value="failed">Failed</option>
      </select>
      <input type="text" 
             id="emailRecipientSearch" 
             placeholder="🔍 Search recipient..." 
             class="admin-search-input"
             oninput="filterEmailLogs()" />
      <button onclick="clearEmailFilters()" class="admin-filter-btn">Clear Filters</button>
    </div>
  `;

  // Sort by timestamp (newest first)
  emailLogsData.sort((a, b) => b.sentAt - a.sentAt);

  const tableHtml = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Type</th>
          <th>Recipient</th>
          <th>Subject</th>
          <th>Status</th>
          <th>Error/Reason</th>
        </tr>
      </thead>
      <tbody id="emailLogsTableBody">
        ${emailLogsData.map(log => createEmailLogRow(log)).join('')}
      </tbody>
    </table>
  `;

  // RETURN: toggles first, then stats, filters, and table
  return subBannerHtml + emailToggleHtml + statsHtml + filterHtml + tableHtml;
}

function createEmailLogRow(log) {
  const date = new Date(log.sentAt);
  const formattedDate = date.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  let statusClass = 'admin-badge-failed';
  if (log.status === 'sent') statusClass = 'admin-badge-success';
  if (log.status === 'skipped') statusClass = 'admin-badge-warning';
  
  const typeClass = `admin-badge-${log.type || 'general'}`;

  return `
    <tr data-recipient="${(log.recipient || '').toLowerCase()}" data-type="${log.type}" data-status="${log.status}">
      <td data-label="Timestamp" style="font-size: 12px; color: #666;">${formattedDate}</td>
      <td data-label="Type"><span class="admin-badge ${typeClass}">${log.type}</span></td>
      <td data-label="Recipient">${log.recipient}</td>
      <td data-label="Subject">${log.subject}</td>
      <td data-label="Status"><span class="admin-badge ${statusClass}">${log.status}</span></td>
      <td data-label="Error/Reason" style="color: ${log.status === 'failed' ? '#dc3545' : '#856404'}; font-size: 12px;">${log.error || log.reason || '-'}</td>
    </tr>
  `;
}


function filterEmailLogs() {
  const typeFilter = document.getElementById('emailTypeFilter')?.value || '';
  const statusFilter = document.getElementById('emailStatusFilter')?.value || '';
  const recipientSearch = document.getElementById('emailRecipientSearch')?.value.toLowerCase().trim() || '';
  
  const tbody = document.getElementById('emailLogsTableBody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr');
  
  rows.forEach(row => {
    const recipient = row.getAttribute('data-recipient') || '';
    const type = row.getAttribute('data-type') || '';
    const status = row.getAttribute('data-status') || '';
    
    const matchesType = !typeFilter || type === typeFilter;
    const matchesStatus = !statusFilter || status === statusFilter;
    const matchesRecipient = !recipientSearch || recipient.includes(recipientSearch);
    
    if (matchesType && matchesStatus && matchesRecipient) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

function clearEmailFilters() {
  const typeFilter = document.getElementById('emailTypeFilter');
  const statusFilter = document.getElementById('emailStatusFilter');
  const recipientSearch = document.getElementById('emailRecipientSearch');
  
  if (typeFilter) typeFilter.value = '';
  if (statusFilter) statusFilter.value = '';
  if (recipientSearch) recipientSearch.value = '';
  
  filterEmailLogs();
}

// Live filter function for tracks
function filterTracksTable() {
  const searchInput = document.getElementById('trackSearchInput');
  if (!searchInput) return;

  const searchTerm = searchInput.value.toLowerCase().trim();
  const tbody = document.getElementById('tracksTableBody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr');
  
  rows.forEach(row => {
    const trackName = row.getAttribute('data-track-name') || '';
    
    if (trackName.includes(searchTerm)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

// Live filter function for cars
function filterCarsTable() {
  const searchInput = document.getElementById('carSearchInput');
  if (!searchInput) return;

  const searchTerm = searchInput.value.toLowerCase().trim();
  const tbody = document.getElementById('carsTableBody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('tr');
  
  rows.forEach(row => {
    const carName = row.getAttribute('data-car-name') || '';
    
    if (carName.includes(searchTerm)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}


// Track management functions
async function addNewTrack() {
  const combo = document.getElementById('newTrackCombo')?.value.trim();
  const imageUrl = document.getElementById('newTrackImageUrl')?.value.trim();

  if (!combo) {
    alert('❌ Please enter a track & layout name');
    return;
  }

  try {
    const trackData = {
      Track_Combos: combo,
      Track_Image_URL: imageUrl
    };

    const tracksRef = window.firebaseRef(window.firebaseDB, 'Tracks');
    await window.firebasePush(tracksRef, trackData);

    alert('✅ Track added successfully!');
    CACHE.tracksMap = null;
    loadAdminTools();
  } catch (err) {
    console.error('addNewTrack error', err);
    alert('❌ Error adding track: ' + err.message);
  }
}

async function updateTrack(index) {
  const track = window.adminTracksData[index];
  if (!track) return;

  const newImageUrl = document.getElementById(`trackUrl-${index}`)?.value.trim();

  try {
    const tracksSnapshot = await window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Tracks'));
    const tracksObject = tracksSnapshot.val();
    
    if (tracksObject && typeof tracksObject === 'object') {
      const keys = Object.keys(tracksObject);
      const firebaseKey = keys[index];
      
      const trackRef = window.firebaseRef(window.firebaseDB, `Tracks/${firebaseKey}`);
      await window.firebaseSet(trackRef, {
        ...track,
        Track_Image_URL: newImageUrl
      });

      alert('✅ Track updated successfully!');
      CACHE.tracksMap = null;
      loadAdminTools();
    }
  } catch (err) {
    console.error('updateTrack error', err);
    alert('❌ Error updating track: ' + err.message);
  }
}

async function deleteTrack(index) {
  const track = window.adminTracksData[index];
  if (!track) return;

  if (!confirm(`⚠️ Delete track "${track.Track_Combos}"?\n\nThis cannot be undone!`)) return;

  try {
    const tracksSnapshot = await window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Tracks'));
    const tracksObject = tracksSnapshot.val();
    
    if (tracksObject && typeof tracksObject === 'object') {
      const keys = Object.keys(tracksObject);
      const firebaseKey = keys[index];
      
      const trackRef = window.firebaseRef(window.firebaseDB, `Tracks/${firebaseKey}`);
      await window.firebaseSet(trackRef, null);

      alert('✅ Track deleted successfully!');
      CACHE.tracksMap = null;
      loadAdminTools();
    }
  } catch (err) {
    console.error('deleteTrack error', err);
    alert('❌ Error deleting track: ' + err.message);
  }
}

// Car management functions
async function addNewCar() {
  const carName = document.getElementById('newCarName')?.value.trim();
  const imageUrl = document.getElementById('newCarImageUrl')?.value.trim();

  if (!carName) {
    alert('❌ Please enter a car name');
    return;
  }

  try {
    const carData = {
      Car_Name: carName,
      Car_Image_URL: imageUrl
    };

    const carsRef = window.firebaseRef(window.firebaseDB, 'Cars');
    await window.firebasePush(carsRef, carData);

    alert('✅ Car added successfully!');
    CACHE.carsMap = null;
    loadAdminTools();
  } catch (err) {
    console.error('addNewCar error', err);
    alert('❌ Error adding car: ' + err.message);
  }
}

async function updateCar(index) {
  const car = window.adminCarsData[index];
  if (!car) return;

  const newImageUrl = document.getElementById(`carUrl-${index}`)?.value.trim();

  try {
    const carsSnapshot = await window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Cars'));
    const carsObject = carsSnapshot.val();
    
    if (carsObject && typeof carsObject === 'object') {
      const keys = Object.keys(carsObject);
      const firebaseKey = keys[index];
      
      const carRef = window.firebaseRef(window.firebaseDB, `Cars/${firebaseKey}`);
      await window.firebaseSet(carRef, {
        ...car,
        Car_Image_URL: newImageUrl
      });

      alert('✅ Car updated successfully!');
      CACHE.carsMap = null;
      loadAdminTools();
    }
  } catch (err) {
    console.error('updateCar error', err);
    alert('❌ Error updating car: ' + err.message);
  }
}

async function deleteCar(index) {
  const car = window.adminCarsData[index];
  if (!car) return;

  if (!confirm(`⚠️ Delete car "${car.Car_Name}"?\n\nThis cannot be undone!`)) return;

  try {
    const carsSnapshot = await window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Cars'));
    const carsObject = carsSnapshot.val();
    
    if (carsObject && typeof carsObject === 'object') {
      const keys = Object.keys(carsObject);
      const firebaseKey = keys[index];
      
      const carRef = window.firebaseRef(window.firebaseDB, `Cars/${firebaseKey}`);
      await window.firebaseSet(carRef, null);

      alert('✅ Car deleted successfully!');
      CACHE.carsMap = null;
      loadAdminTools();
    }
  } catch (err) {
    console.error('deleteCar error', err);
    alert('❌ Error deleting car: ' + err.message);
  }
}

// ============================================================================
// Dynamic Total Time Preview for Lap Time Submission
// ============================================================================
function setupTotalTimePreview() {
  const sector1Sec = document.getElementById('sector1-sec');
  const sector1Ms = document.getElementById('sector1-ms');
  const sector2Sec = document.getElementById('sector2-sec');
  const sector2Ms = document.getElementById('sector2-ms');
  const sector3Sec = document.getElementById('sector3-sec');
  const sector3Ms = document.getElementById('sector3-ms');
  const totalTimeDisplay = document.getElementById('totalTimeDisplay');

  if (!totalTimeDisplay) return;

  function updateTotalTime() {
    // Get values (default to 0 if empty)
    const s1Sec = parseInt(sector1Sec.value) || 0;
    const s1Ms = parseInt(sector1Ms.value) || 0;
    const s2Sec = parseInt(sector2Sec.value) || 0;
    const s2Ms = parseInt(sector2Ms.value) || 0;
    const s3Sec = parseInt(sector3Sec.value) || 0;
    const s3Ms = parseInt(sector3Ms.value) || 0;

    // Calculate total milliseconds
    const totalMs = (s1Sec * 1000 + s1Ms) + (s2Sec * 1000 + s2Ms) + (s3Sec * 1000 + s3Ms);

    // If all fields are empty, show placeholder
    if (totalMs === 0) {
      totalTimeDisplay.textContent = '--:--.---';
      totalTimeDisplay.style.opacity = '0.5';
      return;
    }

    // Convert to minutes:seconds.milliseconds
    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const milliseconds = totalMs % 1000;

    // Format as MM:SS.mmm
    const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
    
    totalTimeDisplay.textContent = formatted;
    totalTimeDisplay.style.opacity = '1';
  }

  // Add input listeners to all sector fields
  const allInputs = [sector1Sec, sector1Ms, sector2Sec, sector2Ms, sector3Sec, sector3Ms];
  allInputs.forEach(input => {
    if (input) {
      input.addEventListener('input', updateTotalTime);
      input.addEventListener('keyup', updateTotalTime);
      input.addEventListener('change', updateTotalTime);
    }
  });

  // Initialize with current values
  updateTotalTime();
}

// ============================================================================
// Manual Recalculate Function for Admin Portal
// ============================================================================
async function manualRecalculate() {
    const recalcButton = document.getElementById('manualRecalcButton');
    const statusDiv = document.getElementById('recalcStatus');
    
    try {
        // Disable button and show loading
        if (recalcButton) {
            recalcButton.disabled = true;
            recalcButton.textContent = '⏳ Recalculating...';
        }
        
        if (statusDiv) {
            statusDiv.style.display = 'block';
            statusDiv.style.background = '#d1ecf1';
            statusDiv.style.color = '#0c5460';
            statusDiv.textContent = '⏳ Recalculating all standings...';
        }
        
        console.log('🔧 Calling Cloud Function to recalculate standings...');
        
        // Call the Cloud Function
        const recalculateStandings = window.httpsCallable(window.firebaseFunctions, 'recalculateStandings');
        const result = await recalculateStandings();
        
        console.log('✅ Cloud Function response:', result.data);
        
        // Show success
        if (statusDiv) {
            statusDiv.style.background = '#d4edda';
            statusDiv.style.color = '#155724';
            statusDiv.textContent = '✅ ' + result.data.message;
        }
        
        // Re-enable button
        if (recalcButton) {
            recalcButton.disabled = false;
            recalcButton.textContent = '🔄 Recalculate All Standings';
        }
        
        // Reload data after 2 seconds
        setTimeout(() => {
            if (statusDiv) statusDiv.style.display = 'none';
            
            // Refresh displays
            if (typeof loadLeaderboard === 'function') loadLeaderboard();
            if (typeof loadRoundData === 'function') loadRoundData();
            if (typeof loadAdminData === 'function') loadAdminData();
            
            alert('✅ Standings recalculated! Data refreshed.');
        }, 2000);
        
    } catch (error) {
        console.error('❌ Error calling recalculate function:', error);
        
        if (statusDiv) {
            statusDiv.style.background = '#f8d7da';
            statusDiv.style.color = '#721c24';
            statusDiv.textContent = '❌ Error: ' + error.message;
        }
        
        if (recalcButton) {
            recalcButton.disabled = false;
            recalcButton.textContent = '🔄 Recalculate All Standings';
        }
        
        alert('❌ Failed to recalculate: ' + error.message);
    }
}

// ============================================================================
// Email Preferences Management
// ============================================================================

// Load email preferences when user logs in
async function loadEmailPreferences() {
  if (!currentUser) return;
  
  try {
    const profileKey = encodeKey(currentUser.name);
    const arrayIndex = DRIVER_PROFILE_INDICES[profileKey];
    
    let profileRef;
    if (arrayIndex !== undefined) {
      // Array-based storage
      profileRef = window.firebaseRef(window.firebaseDB, `Driver_Profiles/${arrayIndex}`);
    } else {
      // Object-based storage
      profileRef = window.firebaseRef(window.firebaseDB, `Driver_Profiles/${profileKey}`);
    }
    
    const snapshot = await window.firebaseGet(profileRef);
    const profile = snapshot.val();
    
    if (profile && profile.emailNotifications) {
      document.getElementById('email-newRound').checked = profile.emailNotifications.newRound !== false;
      document.getElementById('email-fastestLap').checked = profile.emailNotifications.fastestLap !== false;
      document.getElementById('email-weeklyResults').checked = profile.emailNotifications.weeklyResults !== false;
    } else {
      // Default all to true
      document.getElementById('email-newRound').checked = true;
      document.getElementById('email-fastestLap').checked = true;
      document.getElementById('email-weeklyResults').checked = true;
    }
  } catch (error) {
    console.error('Error loading email preferences:', error);
  }
}

// Save email preferences
async function saveEmailPreferences() {
  if (!currentUser) {
    alert('Please log in first');
    return;
  }
  
  const newRound = document.getElementById('email-newRound').checked;
  const fastestLap = document.getElementById('email-fastestLap').checked;
  const weeklyResults = document.getElementById('email-weeklyResults').checked;
  
  const profileKey = encodeKey(currentUser.name);
  const arrayIndex = DRIVER_PROFILE_INDICES[profileKey];
  
  let profileRef;
  if (arrayIndex !== undefined) {
    // Array-based storage
    profileRef = window.firebaseRef(window.firebaseDB, `Driver_Profiles/${arrayIndex}/emailNotifications`);
  } else {
    // Object-based storage
    profileRef = window.firebaseRef(window.firebaseDB, `Driver_Profiles/${profileKey}/emailNotifications`);
  }
  
  try {
    await window.firebaseSet(profileRef, {
      newRound: newRound,
      fastestLap: fastestLap,
      weeklyResults: weeklyResults
    });
    
    const message = document.getElementById('email-pref-message');
    message.style.display = 'block';
    message.style.background = '#d4edda';
    message.style.color = '#155724';
    message.textContent = '✅ Email preferences saved successfully!';
    
    setTimeout(() => {
      message.style.display = 'none';
    }, 3000);
    
    console.log('Email preferences saved:', { newRound, fastestLap, weeklyResults });
    
  } catch (error) {
    console.error('Error saving email preferences:', error);
    const message = document.getElementById('email-pref-message');
    message.style.display = 'block';
    message.style.background = '#f8d7da';
    message.style.color = '#721c24';
    message.textContent = '❌ Error saving preferences: ' + error.message;
  }
}
// Track preview function
function updateTrackPreview(trackCombo) {
  const previewContainer = document.getElementById('trackPreviewContainer');
  const previewImg = document.getElementById('trackPreviewImg');
  const previewLabel = document.getElementById('trackPreviewLabel');
  
  if (!previewContainer || !previewImg || !previewLabel) return;
  
  if (trackCombo && CACHE.tracksMap && CACHE.tracksMap[trackCombo]) {
    const imageUrl = CACHE.tracksMap[trackCombo];
    previewImg.src = imageUrl;
    previewLabel.textContent = trackCombo;
    previewContainer.style.display = 'block';
    
    previewImg.onerror = function() {
      previewImg.src = 'https://static.vecteezy.com/system/resources/previews/015/114/628/non_2x/race-track-icon-isometric-road-circuit-vector.jpg';
    };
  } else {
    previewContainer.style.display = 'none';
  }
}

// Car preview function
function updateCarPreview(carName) {
  const previewContainer = document.getElementById('carPreviewContainer');
  const previewImg = document.getElementById('carPreviewImg');
  const previewLabel = document.getElementById('carPreviewLabel');
  
  if (!previewContainer || !previewImg || !previewLabel) return;
  
  if (carName && CACHE.carsMap && CACHE.carsMap[carName]) {
    const imageUrl = CACHE.carsMap[carName];
    previewImg.src = imageUrl;
    previewLabel.textContent = carName;
    previewContainer.style.display = 'block';
    
    previewImg.onerror = function() {
      previewImg.src = 'https://thumb.silhouette-ac.com/t/e9/e9f1eb16ae292f36be10def00d95ecbb_t.jpeg';
    };
  } else {
    previewContainer.style.display = 'none';
  }
}

// Setup event listeners when page loads
document.addEventListener('DOMContentLoaded', function() {
  const trackDropdown = document.getElementById('trackLayout');
  const carDropdown = document.getElementById('carName');
  
  if (trackDropdown) {
    trackDropdown.addEventListener('change', function() {
      updateTrackPreview(this.value);
    });
  }
  
  if (carDropdown) {
    carDropdown.addEventListener('change', function() {
      updateCarPreview(this.value);
    });
  }
});

/* ========================================
   MOBILE ADMIN TABS SCROLL INDICATORS
   Add this to your script.js file
   ======================================== */

// Admin tabs scroll indicators and smooth scrolling
function initAdminTabsScrolling() {
  const adminTabs = document.querySelector('.admin-tabs');
  
  if (!adminTabs) return;
  
  // Function to update scroll indicator classes
  function updateScrollIndicators() {
    const isScrollable = adminTabs.scrollWidth > adminTabs.clientWidth;
    const isScrolledLeft = adminTabs.scrollLeft > 10;
    const isScrolledToEnd = adminTabs.scrollLeft >= (adminTabs.scrollWidth - adminTabs.clientWidth - 10);
    
    adminTabs.classList.toggle('scrolled-left', isScrolledLeft);
    adminTabs.classList.toggle('scrolled-end', isScrolledToEnd);
    adminTabs.classList.toggle('scrollable-right', isScrollable && !isScrolledToEnd);
  }
  
  // Add event listeners
  adminTabs.addEventListener('scroll', updateScrollIndicators);
  window.addEventListener('resize', updateScrollIndicators);
  
  // Initial check
  updateScrollIndicators();
  
  // Auto-scroll active tab into view
  const activeTab = adminTabs.querySelector('.admin-tab-button.active');
  if (activeTab) {
    setTimeout(() => {
      activeTab.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'nearest', 
        inline: 'center' 
      });
    }, 100);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminTabsScrolling);
} else {
  initAdminTabsScrolling();
}

// Re-initialize when switching to admin tab
function switchAdminTab(tabName) {
  currentAdminTab = tabName;
  loadAdminTools();
  
  // Re-initialize scroll indicators after content loads
  setTimeout(initAdminTabsScrolling, 100);
}

/* ========================================
   ALTERNATIVE: ADD TO EXISTING CODE
   ======================================== 

If you already have a switchAdminTab function, just add this line at the end:

function switchAdminTab(tabName) {
  currentAdminTab = tabName;
  loadAdminTools();
  // Add this line:
  setTimeout(initAdminTabsScrolling, 100);
}

And add this to your existing DOMContentLoaded or initialization:

document.addEventListener('DOMContentLoaded', function() {
  // Your existing code...
  
  // Add this:
  initAdminTabsScrolling();
});

========================================= */
