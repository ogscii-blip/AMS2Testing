/* =========================================================
   Optimized script.js for AMS2 Racing League - v5.1
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
let APPS_SCRIPT_URL = null;
let currentUser = null;      // { name: username, email? }

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
      const raw = snapshot.val();
      if (!raw) {
        DRIVER_PROFILES = {};
        return;
      }
      // If stored as array (legacy), convert to username-keyed map by using Name or Email fallback.
      if (Array.isArray(raw)) {
        const mapped = {};
        raw.forEach(item => {
          if (!item) return;
          const nameKey = item.Username || item.Name || (item.Email ? item.Email.split('@')[0] : null);
          if (nameKey) mapped[encodeKey(nameKey)] = {
            name: item.Name || '',
            surname: item.Surname || '',
            number: item.Number ? String(item.Number) : '',
            photoUrl: item.Photo_URL || item.Photo_URL || '',
            bio: item.Bio || ''
          };
        });
        DRIVER_PROFILES = mapped;
      } else {
        // Object keyed already: normalize photo and ensure fields exist
        const mapped = {};
        Object.entries(raw).forEach(([key, item]) => {
          if (!item) return;
          mapped[key] = {
            name: item.Name || item.Username || '',
            surname: item.Surname || '',
            number: item.Number ? String(item.Number) : '',
            photoUrl: item.Photo_URL || item.Photo || '',
            bio: item.Bio || ''
          };
        });
        DRIVER_PROFILES = mapped;
      }
      console.log('Driver profiles loaded:', Object.keys(DRIVER_PROFILES).length);
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
    // FIXED: Pre-select current (latest) season in Round Results by default
    preSelectCurrentSeasonInRoundResults();
    loadRoundData();
  } else if (tabName === 'drivers') {
    loadDriverStats();
  } else if (tabName === 'profile') {
    loadProfile();
  } else if (tabName === 'setup') {
    loadRoundSetup();
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
    const cumulativePoints = [0];
    let total = 0;

    sortedRounds.forEach(round => {
      total += (driverRounds[driver][round] || 0);
      cumulativePoints.push(total);
    });

    const profile = DRIVER_PROFILES[encodeKey(driver)] || {};
    const driverColor = colors[colorIndex % colors.length];
    colorIndex++;

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
      labels: ['R0', ...sortedRounds.map(r => `R${r}`)],
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: window.innerWidth <= 768 ? 1.2 : 2.5,
      animation: false,
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

  // Use Intersection Observer to trigger animation only when visible
  setupChartVisibilityObserver(graphContainer, sortedRounds);
}
function setupChartVisibilityObserver(graphContainer, rounds) {
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
   Core: Leaderboard (season-aware)
   ----------------------------- */
async function loadLeaderboard() {
  try {
    const seasonSelect = document.getElementById('seasonSelect');
    const selectedSeason = seasonSelect?.value || '';

    // FIXED: Load Round_Data to calculate points accurately per season
    const [roundDataSnapshot, rawLapsSnapshot] = await Promise.all([
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Round_Data')),
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Form_responses_1'))
    ]);
    
    const roundData = toArray(roundDataSnapshot.val()).filter(r => r && r.Driver);
    const rawLapsData = toArray(rawLapsSnapshot.val()).filter(r => r && r.Driver);

    // Filter Round_Data by season
    const filteredRoundData = selectedSeason 
      ? roundData.filter(r => String(r.Season) == String(selectedSeason))
      : roundData;

    // FIXED: Calculate driver totals from Round_Data (actual scored rounds)
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

    // FIXED: Include drivers who have submitted laps but may not be in Round_Data yet
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

    // Attach ranks
    const displayData = driversArr.map((d,i)=>({
      position: i+1,
      driver: d.driver,
      points: d.points,
      purpleSectors: d.purpleSectors,
      wins: d.wins
    }));

    displayLeaderboard(displayData);

    // Cards - use filtered data
    document.getElementById('totalDrivers').textContent = displayData.length;
    const totalPoints = displayData.reduce((s,d)=>s + (d.points||0), 0);
    document.getElementById('totalPoints').textContent = totalPoints;

    // FIXED: Rounds completed - count rounds with 3+ submissions (completed rounds)
    const roundSubmissions = {};
    filteredLaps.forEach(lap => {
      const key = `S${lap.Season}-R${lap.Round}`;
      if (!roundSubmissions[key]) roundSubmissions[key] = new Set();
      roundSubmissions[key].add(lap.Driver);
    });
    
    const completedRounds = Object.values(roundSubmissions).filter(drivers => drivers.size >= 3).length;
    document.getElementById('totalRounds').textContent = completedRounds;

    // FIXED: Create animated points progression graph
    createPointsProgressionGraph(filteredRoundData, selectedSeason);

    // Populate season dropdowns from cached setup (but call populate if needed)
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

  // Add click listeners
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
    // Use cached setup if present
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
    // Load once and cache heavy objects
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

    // Build filtered and normalized allData array
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

    // Group by S{season}-R{round}
    const roundGroups = {};
    allData.forEach(r => {
      const key = `S${r.season}-R${r.round}`;
      if (!roundGroups[key]) roundGroups[key] = { season: r.season, round: r.round, results: [] };
      roundGroups[key].results.push(r);
    });

    // Determine fastest sectors & sort results for each group
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

  // FIXED: Sort rounds in DESCENDING order (latest first)
  const sortedKeys = Object.keys(roundGroups).sort((a,b) => {
    const [sa, ra] = a.replace('S','').split('-R').map(Number);
    const [sb, rb] = b.replace('S','').split('-R').map(Number);
    if (sa !== sb) return sb - sa; // Descending by season
    return rb - ra; // Descending by round
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
          <th>Total Time</th><th>Position</th><th>Purple Sectors</th><th>Points</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    results.forEach(row => {
      const tr = document.createElement('tr');
      if (row.position === 1) tr.classList.add('position-1');
      if (row.position === 2) tr.classList.add('position-2');
      if (row.position === 3) tr.classList.add('position-3');

      const sector1Html = row.purpleSector1 ? `<span class="purple-sector">${formatTime(row.sector1)}</span>` : formatTime(row.sector1);
      const sector2Html = row.purpleSector2 ? `<span class="purple-sector">${formatTime(row.sector2)}</span>` : formatTime(row.sector2);
      const sector3Html = row.purpleSector3 ? `<span class="purple-sector">${formatTime(row.sector3)}</span>` : formatTime(row.sector3);

      const formattedName = getFormattedDriverName(row.driver);

      tr.innerHTML = `
        <td data-label="Driver"><strong class="driver-link-round" data-driver="${row.driver}" style="cursor:pointer;color:#667eea">${formattedName}</strong></td>
        <td data-label="Sector 1">${sector1Html}</td>
        <td data-label="Sector 2">${sector2Html}</td>
        <td data-label="Sector 3">${sector3Html}</td>
        <td data-label="Total Time"><strong>${formatTime(row.totalTime)}</strong></td>
        <td data-label="Position">${row.position}</td>
        <td data-label="Purple Sectors">${row.purpleSectors}</td>
        <td data-label="Points"><strong>${row.points}</strong></td>
      `;
      tbody.appendChild(tr);
    });

    details.appendChild(table);
    roundDiv.appendChild(header);
    roundDiv.appendChild(details);
    frag.appendChild(roundDiv);
  });

  container.appendChild(frag);

  // Add driver link click handlers
  container.querySelectorAll('.driver-link-round').forEach(link => {
    link.addEventListener('click', function() {
      goToDriverProfile(this.getAttribute('data-driver'));
    });
  });

  // FIXED: Auto-expand the FIRST round (which is the latest due to descending sort)
  if (sortedKeys.length > 0) {
    setTimeout(() => {
      const latestKey = sortedKeys[0]; // First in list is now the latest
      const d = document.getElementById(`details-${latestKey}`);
      const i = document.getElementById(`toggle-${latestKey}`);
      if (d) d.classList.add('expanded');
      if (i) i.classList.add('expanded');
    }, 150);
  }

  document.getElementById('round-loading').style.display = 'none';
  document.getElementById('round-content').style.display = 'block';
}

function toggleRound(key) {
  const details = document.getElementById(`details-${key}`);
  const icon = document.getElementById(`toggle-${key}`);
  if (!details) return;
  details.classList.toggle('expanded');
  if (icon) icon.classList.toggle('expanded');
}

/* -----------------------------
   Round Setup & Cards
   ----------------------------- */
async function loadTracksAndCars() {
  // Ensure caches exist
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

  // Populate selects
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
    // Invalidate cache so populateSeasonFilter picks it up
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

    // Create unique latest setup per season/round
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
    // update cached setup
    CACHE.setupArray = setupArr;
    populateSeasonFilter();

  } catch (err) {
    console.error('loadRoundSetup error', err);
  }
}

function displayRoundCards(setupData, roundData, tracksMap={}, carsMap={}) {
  const container = document.getElementById('round-cards-grid');
  container.innerHTML = '';

  if (!setupData || !setupData.length) {
    container.innerHTML = '<p style="text-align:center;padding:40px;color:#666;">No rounds configured yet. Use the form below to add your first round!</p>';
    return;
  }

  // FIXED: Placeholder images properly defined for cards
  const fallbackTrackImage = 'https://static.vecteezy.com/system/resources/previews/015/114/628/non_2x/race-track-icon-isometric-road-circuit-vector.jpg';
  const fallbackCarImage = 'https://thumb.silhouette-ac.com/t/e9/e9f1eb16ae292f36be10def00d95ecbb_t.jpeg';

  // Pre-index roundData by (season,round) and combo
  const bySeasonRound = {};
  const byCombo = {}; // track|car -> array
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

/* -----------------------------
   Driver Stats
   ----------------------------- */
async function loadDriverStats() {
  try {
    const [roundSnap, leaderboardSnap] = await Promise.all([
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Round_Data')),
      window.firebaseGet(window.firebaseRef(window.firebaseDB, 'Leaderboard'))
    ]);
    const roundArr = toArray(roundSnap.val());
    const leaderboardArr = toArray(leaderboardSnap.val());

    // Precompute champion positions map
    const champSorted = leaderboardArr.slice().filter(l=>l && l.Driver).sort((a,b)=> (parseInt(b['Total_Points'])||0) - (parseInt(a['Total_Points'])||0));
    const champPos = {};
    champSorted.forEach((r,i)=> { if (r && r.Driver) champPos[r.Driver] = i+1; });

    // Unique drivers from leaderboard (or round data fallback)
    const drivers = [...new Set((leaderboardArr.map(r=>r.Driver).filter(Boolean)).concat(roundArr.map(r=>r.Driver).filter(Boolean)))].filter(Boolean);

    const driversContent = document.getElementById('drivers-content');
    driversContent.innerHTML = '';
    const frag = document.createDocumentFragment();

    // Index round data by driver for faster queries
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

      // Personal best
      let personalBest = null;
      if (driverRoundData.length) {
        personalBest = driverRoundData.reduce((best,cur)=> {
          const c = parseFloat(cur['Total_Lap_Time']) || Infinity;
          const b = best ? parseFloat(best['Total_Lap_Time']) || Infinity : Infinity;
          return c < b ? cur : best;
        }, null);
      }

      // Track+Car records for this driver
      const trackCarRecordsMap = {};
      driverRoundData.forEach(r => {
        const key = `${r['Track-Layout'] || ''} - ${r['Car_Name'] || ''}`;
        const t = parseFloat(r['Total_Lap_Time']) || Infinity;
        if (!trackCarRecordsMap[key] || t < trackCarRecordsMap[key].time) trackCarRecordsMap[key] = { combo: key, time: t, timeFormatted: formatTime(r['Total_Lap_Time']) };
      });
      const trackCarRecordsArray = Object.values(trackCarRecordsMap).sort((a,b)=>a.time-b.time);

      // Favorite track/car
      const trackCounts = {}; const carCounts = {};
      driverRoundData.forEach(r => { if (r['Track-Layout']) trackCounts[r['Track-Layout']] = (trackCounts[r['Track-Layout']]||0)+1; if (r['Car_Name']) carCounts[r['Car_Name']] = (carCounts[r['Car_Name']]||0)+1; });
      const favoriteTrack = Object.keys(trackCounts).sort((a,b)=>trackCounts[b]-trackCounts[a])[0] || 'N/A';
      const favoriteCar = Object.keys(carCounts).sort((a,b)=>carCounts[b]-carCounts[a])[0] || 'N/A';

      // Head-to-heads (optimized): build positions per round
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

      // profile lookup by username key
      const profileKey = encodeKey(driverName);
      const profile = DRIVER_PROFILES[profileKey] || {};

      // FIXED: Format names based on login status
      let formattedName, formattedShortName;
      if (currentUser && profile && profile.surname) {
        formattedName = `${profile.name} ${profile.surname}`;
        formattedShortName = `${profile.name.charAt(0)}. ${profile.surname}`;
      } else if (!currentUser && profile && profile.surname) {
        // Not logged in: show initials only
        formattedName = `${profile.name.charAt(0)}. ${profile.surname.charAt(0)}.`;
        formattedShortName = `${profile.name.charAt(0)}. ${profile.surname.charAt(0)}.`;
      } else {
        formattedName = driverName;
        formattedShortName = driverName;
      }
      
      const championshipPosition = champPos[driverName] || 'N/A';

      // Build card
      const card = document.createElement('div'); card.className = 'driver-card'; card.setAttribute('data-driver', driverName);
      
      // FIXED: Show different content based on login status
      let desktopPhotoHtml = '';
      let mobilePhotoHtml = '';
      
      if (currentUser) {
        // Logged in: show photo if available
        desktopPhotoHtml = profile && profile.photoUrl 
          ? `<div class="driver-photo-container"><img src="${normalizePhotoUrl(profile.photoUrl)}" alt="${formattedName}" class="driver-photo"><div class="driver-number-badge">${profile.number||'?'}</div></div>` 
          : '';
        mobilePhotoHtml = profile && profile.photoUrl 
          ? `<div class="driver-photo-container-mobile"><img src="${normalizePhotoUrl(profile.photoUrl)}" alt="${formattedName}" class="driver-photo-mobile"><div class="driver-number-badge-mobile">${profile.number||'?'}</div></div>` 
          : '';
      } else {
        // Not logged in: show number badge instead of photo
        const driverNumber = profile && profile.number ? profile.number : '?';
        desktopPhotoHtml = `<div class="driver-number-placeholder">${driverNumber}</div>`;
        mobilePhotoHtml = `<div class="driver-number-placeholder-mobile">${driverNumber}</div>`;
      }

      const trackCarRecordsHtml = trackCarRecordsArray.length ? trackCarRecordsArray.map(r=> `<div class="record-item"><span>${r.combo}</span><strong>${r.timeFormatted}</strong></div>`).join('') : '<p style="color:#999;text-align:center">No records yet</p>';
      const h2hHtml = Object.entries(h2hRecords).length ? Object.entries(h2hRecords).map(([op,rec])=> `<div class="h2h-card"><div class="opponent">vs ${getFormattedDriverName(op, false)}</div><div class="record">${rec.wins}W - ${rec.losses}L</div></div>`).join('') : '<p style="color:#999;text-align:center">No head-to-head data yet</p>';

      card.innerHTML = `
        <div class="driver-header">${desktopPhotoHtml}<div class="driver-info"><h2>${formattedName}</h2><div class="driver-position">Championship Position: ${championshipPosition}</div></div></div>
        <div class="driver-header-mobile">${mobilePhotoHtml}<div class="driver-name-mobile">${formattedShortName}</div><div class="driver-stats-compact"><div class="stat-compact-item"><span class="stat-compact-label">Championship Position:</span><span class="stat-compact-value">${championshipPosition}</span></div><div class="stat-compact-row"><div class="stat-compact-item"><span class="stat-compact-label">Total Points:</span><span class="stat-compact-value">${totalPoints}</span></div><div class="stat-compact-item"><span class="stat-compact-label">Races:</span><span class="stat-compact-value">${totalRounds}</span></div></div></div></div>
        <div class="stats-grid-driver"><div class="stat-card-driver"><h3>Total Points</h3><p class="stat-value">${totalPoints}</p></div><div class="stat-card-driver"><h3>Wins</h3><p class="stat-value">${totalWins}</p></div><div class="stat-card-driver"><h3>Purple Sectors</h3><p class="stat-value">${totalPurpleSectors}</p></div><div class="stat-card-driver"><h3>Avg Position</h3><p class="stat-value">${avgPosition}</p></div></div>
        ${profile && profile.bio ? `<p style="text-align:center;color:#666;margin:20px 0;font-style:italic;">"${profile.bio}"</p>` : ''}
        <div class="driver-records-section"><h3 class="section-title">🏆 Lap Time Records</h3><div class="lap-records"><div class="personal-best"><strong style="color:#667eea;">Personal Best Lap:</strong><div style="font-size:1.5em;font-weight:bold;color:#2c3e50;margin:5px 0;">${personalBest ? formatTime(personalBest['Total_Lap_Time']) : 'N/A'}</div>${personalBest ? `<div style="font-size:0.9em;color:#666;">${personalBest['Track-Layout']}<br>${personalBest['Car_Name']}</div>` : ''}</div><div class="quick-stats"><div class="quick-stat-item"><strong style="color:#667eea;">Purple Sectors:</strong> ${totalPurpleSectors}</div><div class="quick-stat-item"><strong style="color:#667eea;">Favorite Track:</strong> ${favoriteTrack}</div><div class="quick-stat-item"><strong style="color:#667eea;">Favorite Car:</strong> ${favoriteCar}</div></div></div></div>
        <div class="driver-records-section"><h3 class="section-title">📍 Track + Car Records</h3><div class="track-car-records">${trackCarRecordsHtml}</div></div>
        <div class="driver-records-section"><h3 class="section-title">⚔️ Head-to-Head Record</h3><div class="h2h-grid">${h2hHtml}</div></div>
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
  if (!currentUser) { profileWarning.style.display = 'block'; profileContent.style.display = 'none'; return; }
  profileWarning.style.display = 'none'; profileContent.style.display = 'block';

  const profile = DRIVER_PROFILES[encodeKey(currentUser.name)] || {};
  document.getElementById('profileName').value = profile.name || '';
  document.getElementById('profileSurname').value = profile.surname || '';
  document.getElementById('profileNumber').value = profile.number || '';
  document.getElementById('profilePhotoUrl').value = profile.photoUrl || '';
  document.getElementById('profileBio').value = profile.bio || '';

  if (profile.photoUrl) {
    document.getElementById('photoPreviewImg').src = normalizePhotoUrl(profile.photoUrl);
    document.getElementById('photoPreview').style.display = 'block';
  }
}

document.getElementById('profileForm')?.addEventListener('submit', async function(e){
  e.preventDefault();
  if (!currentUser) { alert('Please sign in to update your profile'); return; }
  const messageDiv = document.getElementById('profileMessage'); messageDiv.style.display = 'block'; messageDiv.textContent = '⏳ Saving profile...';

  try {
    const profileData = {
      Name: document.getElementById('profileName').value.trim(),
      Surname: document.getElementById('profileSurname').value.trim(),
      Number: document.getElementById('profileNumber').value,
      Photo_URL: document.getElementById('profilePhotoUrl').value.trim(),
      Bio: document.getElementById('profileBio').value.trim()
    };

    // Save to Driver_Profiles/{usernameKey}
    const usernameKey = encodeKey(currentUser.name);
    const profileRef = window.firebaseRef(window.firebaseDB, `Driver_Profiles/${usernameKey}`);
    await window.firebaseSet(profileRef, {
      Name: profileData.Name,
      Surname: profileData.Surname,
      Number: profileData.Number,
      Photo_URL: profileData.Photo_URL,
      Bio: profileData.Bio
    });

    // Update local cache
    DRIVER_PROFILES[usernameKey] = {
      name: profileData.Name,
      surname: profileData.Surname,
      number: String(profileData.Number),
      photoUrl: profileData.Photo_URL,
      bio: profileData.Bio
    };

    messageDiv.style.background='#d4edda'; messageDiv.style.color='#155724'; messageDiv.textContent='✅ Profile saved!';
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
    messageDiv.style.background='#f8d7da'; messageDiv.style.color='#721c24'; messageDiv.textContent='❌ ' + err.message;
  }
});

// Photo file input handler
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
    // Read all sector input fields
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

    // Ensure setup exists
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

    // FIXED: Reset the form after successful submission
    document.getElementById('lapTimeForm').reset();

    // refresh caches/loaders
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
  // driverLoginName is the username used in ALLOWED_USERS
  const profile = DRIVER_PROFILES[encodeKey(driverLoginName)];
  
  // If logged in and profile exists with full info, show formatted name with number
  if (currentUser && profile && profile.surname && profile.name) {
    const number = profile.number || '?';
    return includeNumber 
      ? `${profile.name.charAt(0)}. ${profile.surname} - ${number}`
      : `${profile.name.charAt(0)}. ${profile.surname}`;
  }
  
  // If NOT logged in but profile exists, show initials only
  if (!currentUser && profile && profile.surname && profile.name) {
    return `${profile.name.charAt(0)}. ${profile.surname.charAt(0)}.`;
  }
  
  // Fallback to username
  return driverLoginName;
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

    // profile display
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
    if (lapTimeFormContainer) lapTimeFormContainer.style.display = 'block'; 
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
    updateSubmitTabVisibility(); // Ensure tabs are hidden if no session
    return;
  }
  currentUser = JSON.parse(stored);
  // Wait for profiles to load via onValue from loadConfig()
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

// Mobile logo switch
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

// Consolidated DOMContentLoaded listener
document.addEventListener('DOMContentLoaded', function() {
  // Set initial tab visibility before any login
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
