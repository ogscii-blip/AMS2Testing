// Tab switching functionality
function showTab(tabName, evt) {
    // Hide all tabs
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Remove active class from all buttons
    const buttons = document.querySelectorAll('.tab-button');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    // Show selected tab
    const tabEl = document.getElementById(tabName);
    if (tabEl) tabEl.classList.add('active');
    
    // Add active class to clicked button (evt may be undefined)
    if (evt && evt.target) {
        evt.target.classList.add('active');
    }
    
    // Load data if needed
    if (tabName === 'overall') {
        loadLeaderboard();
    } else if (tabName === 'round') {
        loadRoundData();
    } else if (tabName === 'drivers') {
        loadDriverStats();
    } else if (tabName === 'profile') {
        loadProfile();
    } else if (tabName === 'setup') {
        loadRoundSetup();
    }
}

// Navigate to Round Results tab and expand the driver's latest round
async function goToDriverCurrentRound(driverName) {
    showTab('round');
    await new Promise(resolve => setTimeout(resolve, 300));

    if (typeof loadRoundData === "function") {
        await loadRoundData();
    }

    await new Promise(resolve => setTimeout(resolve, 300));

    const allRounds = [...document.querySelectorAll('[id^="details-"]')]
        .map(e => parseInt(e.id.replace("details-", ""), 10))
        .filter(n => !isNaN(n));

    if (allRounds.length === 0) {
        console.warn("No rounds found in DOM.");
        return;
    }

    const latestRound = Math.max(...allRounds);
    const details = document.getElementById(`details-${latestRound}`);
    const icon = document.getElementById(`toggle-${latestRound}`);

    if (!details) {
        console.warn("Could not find latest round DOM element.");
        return;
    }

    details.classList.add("expanded");
    if (icon) icon.classList.add("expanded");

    details.scrollIntoView({ behavior: "smooth", block: "start" });

    details.style.transition = "background 0.4s ease";
    details.style.background = "#fffa9c";
    setTimeout(() => {
        details.style.background = "";
    }, 700);
}

// Navigate to Driver Profile
function goToDriverProfile(driverName) {
    showTab("drivers");
    setTimeout(() => {
        const card = document.querySelector(`.driver-card[data-driver="${driverName}"]`);
        if (card) {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            card.style.transition = "background 0.4s ease";
            const originalBg = card.style.background;
            card.style.background = "#fffa9c";
            setTimeout(() => {
                card.style.background = originalBg;
            }, 700);
        }
    }, 300);
}

// Format driver name as "N. Surname - #"
function getFormattedDriverName(driverLoginName) {
    if (!driverLoginName) return '';
    let profile = null;
    
    if (typeof ALLOWED_USERS === 'object' && ALLOWED_USERS) {
        for (const loginName in ALLOWED_USERS) {
            if (loginName === driverLoginName) {
                const email = ALLOWED_USERS[loginName]?.email;
                if (email && DRIVER_PROFILES && DRIVER_PROFILES[email]) {
                    profile = DRIVER_PROFILES[email];
                    break;
                }
            }
        }
    }
    
    if (profile && profile.surname && profile.number) {
        return `${profile.name.charAt(0)}. ${profile.surname} - ${profile.number}`;
    }
    
    return driverLoginName;
}

// Normalizer: convert Firebase snapshots (object or array) to array
function asArray(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    // If object with numeric keys or push IDs => use values
    return Object.values(data);
}

// Helper: convert seconds/format string to seconds as Number
function lapTimeToSeconds(value) {
    if (value == null || value === "") return NaN;
    // if it's already in MM:SS,mmm format, parse it
    if (typeof value === 'string' && value.includes(':')) {
        try {
            return timeToSeconds(value);
        } catch (e) {
            return NaN;
        }
    }
    // otherwise, assume numeric seconds (string or number)
    const n = Number(value);
    return isFinite(n) ? n : NaN;
}

// Format time: accepts either seconds number (or numeric string) or already-formatted "MM:SS,mmm"
function formatTime(value) {
    if (value == null || value === "") return "";
    if (typeof value === 'string' && value.includes(':')) {
        // assume already formatted
        return value;
    }
    const totalSeconds = Number(value);
    if (!isFinite(totalSeconds)) return "";
    const minutes = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    const milliseconds = Math.round((totalSeconds % 1) * 1000);
    
    const mm = String(minutes).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    const ms = String(milliseconds).padStart(3, '0');
    
    return `${mm}:${ss},${ms}`;
}

// Helper function to convert time format MM:SS,mmm to seconds
function timeToSeconds(timeStr) {
    if (timeStr == null || timeStr === '') return 0;
    if (typeof timeStr === 'number') return timeStr;
    if (typeof timeStr !== 'string') return NaN;
    // Accept "MM:SS,mmm" or "M:SS,mmm"
    const parts = timeStr.split(':');
    if (parts.length !== 2) {
        // maybe it's already seconds as string
        const v = Number(timeStr);
        return isFinite(v) ? v : NaN;
    }
    const minutes = parseInt(parts[0], 10);
    const secondsParts = parts[1].split(',');
    const seconds = parseInt(secondsParts[0], 10);
    const milliseconds = parseInt(secondsParts[1] || '0', 10);
    if (isNaN(minutes) || isNaN(seconds) || isNaN(milliseconds)) return NaN;
    return minutes * 60 + seconds + (milliseconds / 1000);
}

// Robust Google Drive file id parser
function extractDriveThumbnail(photoUrl) {
    if (!photoUrl || typeof photoUrl !== 'string') return null;
    // direct uc id
    if (photoUrl.includes('drive.google.com/uc?id=')) {
        const params = new URLSearchParams(photoUrl.split('?')[1] || '');
        const id = params.get('id');
        if (id) return `https://lh3.googleusercontent.com/d/${id}=s200`;
    }
    // share link formats
    // e.g. https://drive.google.com/file/d/FILEID/view?usp=sharing
    const match = photoUrl.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (match) return `https://lh3.googleusercontent.com/d/${match[1]}=s200`;
    // fallback to original
    return photoUrl;
}

// Global variables
let ALLOWED_USERS = {};
let APPS_SCRIPT_URL = null;
let DRIVER_PROFILES = {};
let currentUser = null;

// Load configuration from Firebase
async function loadConfig() {
    const configRef = window.firebaseRef(window.firebaseDB, 'Config');
    window.firebaseOnValue(configRef, (snapshot) => {
        const configDataRaw = snapshot.val();
        if (!configDataRaw) return;

        const configData = asArray(configDataRaw);

        const configMap = {};
        configData.forEach(row => {
            const setting = (row['Setting'] || '').toString().trim();
            const value = (row['Value'] || '').toString().trim();
            if (setting && value) {
                configMap[setting] = value;
            }
        });

        APPS_SCRIPT_URL = configMap['apps_script_url'] || null;

        const newAllowed = {};
        for (let i = 1; i <= 10; i++) {
            const name = configMap['allowed_name_' + i];
            const email = configMap['allowed_email_' + i];
            const password = configMap['allowed_password_' + i];
            
            if (name && email && password) {
                newAllowed[name] = { email, password };
            }
        }
        ALLOWED_USERS = newAllowed;

        console.log('Config loaded from Firebase:', Object.keys(ALLOWED_USERS).length, 'users');
    });

    const profilesRef = window.firebaseRef(window.firebaseDB, 'Driver_Profiles');
    window.firebaseOnValue(profilesRef, (snapshot) => {
        const profilesDataRaw = snapshot.val();
        if (!profilesDataRaw) return;

        const profilesData = asArray(profilesDataRaw);

        const newProfiles = {};
        profilesData.forEach(profile => {
            const email = (profile['Email'] || '').toString().trim();
            if (email) {
                newProfiles[email] = {
                    name: (profile['Name'] || '').toString().trim(),
                    surname: (profile['Surname'] || '').toString().trim(),
                    number: (profile['Number'] != null) ? profile['Number'].toString() : '',
                    photoUrl: (profile['Photo_URL'] || '').toString().trim(),
                    bio: (profile['Bio'] || '').toString().trim()
                };
            }
        });

        DRIVER_PROFILES = newProfiles;

        console.log('Driver profiles loaded from Firebase:', Object.keys(DRIVER_PROFILES).length);
    });
}

// Load leaderboard with season filter
async function loadLeaderboard() {
    const seasonSelect = document.getElementById('seasonSelect');
    const selectedSeason = seasonSelect ? seasonSelect.value : '';
    
    const leaderboardRef = window.firebaseRef(window.firebaseDB, 'Leaderboard');
    
    try {
        const snapshot = await window.firebaseGet(leaderboardRef);
        const raw = snapshot.val();
        if (!raw) {
            console.log('No leaderboard data found');
            document.getElementById('leaderboard-loading').style.display = 'none';
            document.getElementById('leaderboard-content').style.display = 'block';
            displayLeaderboard([]);
            return;
        }

        let leaderboardData = asArray(raw);

        // defensive: ensure objects contain Driver
        leaderboardData = leaderboardData.filter(row => row && row.Driver);

        // Apply season filter if selected
        if (selectedSeason) {
            leaderboardData = leaderboardData.filter(row => row.Season == selectedSeason);
        }
        
        let data = leaderboardData
            .map((row, index) => ({
                position: index + 1,
                driver: row.Driver,
                points: parseInt(row['Total_Points']) || 0,
                purpleSectors: parseInt(row['Total_Purple_Sectors']) || 0,
                wins: parseInt(row['Total_Wins']) || 0,
                season: row.Season
            }))
            .sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                if (b.wins !== a.wins) return b.wins - a.wins;
                return b.purpleSectors - a.purpleSectors;
            });

        displayLeaderboard(data);
        
        const totalDriversEl = document.getElementById('totalDrivers');
        if (totalDriversEl) totalDriversEl.textContent = data.length;
        const totalPoints = data.reduce((sum, driver) => sum + driver.points, 0);
        const totalPointsEl = document.getElementById('totalPoints');
        if (totalPointsEl) totalPointsEl.textContent = totalPoints;
        
        loadRoundsCount();
        populateSeasonFilter();
    } catch (err) {
        console.error('Error loading leaderboard:', err);
        document.getElementById('leaderboard-loading').innerHTML = '<p style="color: red;">Error loading leaderboard</p>';
    }
}

// Populate season dropdown
async function populateSeasonFilter() {
    const setupRef = window.firebaseRef(window.firebaseDB, 'Form_responses_2');
    try {
        const snapshot = await window.firebaseGet(setupRef);
        const raw = snapshot.val();
        if (!raw) return;
        
        const setupData = asArray(raw);
        const seasons = [...new Set(setupData.map(s => s.Season))].filter(s => s != null && s !== '').sort((a, b) => a - b);
        
        const seasonSelect = document.getElementById('seasonSelect');
        if (!seasonSelect) return;
        const currentValue = seasonSelect.value;
        
        seasonSelect.innerHTML = '<option value="">All Seasons</option>';
        seasons.forEach(season => {
            const option = document.createElement('option');
            option.value = season;
            option.textContent = `Season ${season}`;
            seasonSelect.appendChild(option);
        });
        
        seasonSelect.value = currentValue;
    } catch (err) {
        console.error('Error populating seasons:', err);
    }
}

async function loadRoundsCount() {
    const roundDataRef = window.firebaseRef(window.firebaseDB, 'Round_Data');
    try {
        const snapshot = await window.firebaseGet(roundDataRef);
        const raw = snapshot.val();
        if (!raw) {
            const el = document.getElementById('totalRounds');
            if (el) el.textContent = '0';
            return;
        }
        const roundData = asArray(raw);
        const rounds = [...new Set(roundData.map(r => r.Round))].filter(r => r != null && r !== '');
        const el = document.getElementById('totalRounds');
        if (el) el.textContent = rounds.length;
    } catch (err) {
        console.error('Error loading rounds count:', err);
    }
}

function displayLeaderboard(data) {
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    data.forEach((row, index) => {
        const tr = document.createElement('tr');
        if (index === 0) tr.classList.add('position-1');
        if (index === 1) tr.classList.add('position-2');
        if (index === 2) tr.classList.add('position-3');
        
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
        const formattedName = getFormattedDriverName(row.driver);
        
        tr.innerHTML = `
            <td data-label="Position"><span class="medal">${medal}</span>${row.position}</td>
            <td data-label="Driver"><strong style="cursor: pointer; color: #667eea;" class="driver-link" data-driver="${row.driver}">${formattedName}</strong></td>
            <td data-label="Points"><strong>${row.points}</strong></td>
            <td data-label="Purple Sectors">${row.purpleSectors}</td>
            <td data-label="Wins">${row.wins}</td>
        `;
        tbody.appendChild(tr);
    });

    document.querySelectorAll('.driver-link').forEach(link => {
        link.addEventListener('click', function(e) {
            const driverName = this.getAttribute('data-driver');
            goToDriverCurrentRound(driverName);
        });
    });
    
    const loadingEl = document.getElementById('leaderboard-loading');
    const contentEl = document.getElementById('leaderboard-content');
    if (loadingEl) loadingEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';
}

// Load round data
async function loadRoundData() {
    const roundDataRef = window.firebaseRef(window.firebaseDB, 'Round_Data');
    const tracksRef = window.firebaseRef(window.firebaseDB, 'Tracks');
    const carsRef = window.firebaseRef(window.firebaseDB, 'Cars');
    
    try {
        const [roundSnapshot, tracksSnapshot, carsSnapshot] = await Promise.all([
            window.firebaseGet(roundDataRef),
            window.firebaseGet(tracksRef),
            window.firebaseGet(carsRef)
        ]);
        
        const roundData = asArray(roundSnapshot.val());
        const tracksData = asArray(tracksSnapshot.val());
        const carsData = asArray(carsSnapshot.val());
        
        const tracksMap = {};
        tracksData.forEach(row => {
            const trackCombo = row['Track_Combos'];
            const trackImage = row['Track_Image_URL'];
            if (trackCombo) {
                tracksMap[trackCombo.toString().trim()] = trackImage || 'https://via.placeholder.com/60x60?text=Track';
            }
        });
        
        const carsMap = {};
        carsData.forEach(row => {
            const carName = row['Car_Name'];
            const carImage = row['Car_Image_URL'];
            if (carName) {
                carsMap[carName.toString().trim()] = carImage || 'https://via.placeholder.com/60x60?text=Car';
            }
        });
        
        const allData = roundData
            .filter(row => row && row.Driver && row.Position != null)
            .map((row, index) => ({
                round: row.Round,
                driver: row.Driver,
                sector1: row['Sector_1'] != null ? row['Sector_1'].toString() : '',
                sector2: row['Sector_2'] != null ? row['Sector_2'].toString() : '',
                sector3: row['Sector_3'] != null ? row['Sector_3'].toString() : '',
                totalTime: (row['Total_Lap_Time'] != null) ? row['Total_Lap_Time'] : '',
                position: parseInt(row.Position, 10) || 0,
                purpleSectors: parseInt(row['Purple_Sectors']) || 0,
                points: parseInt(row['Total_Points']) || 0,
                timestamp: index,
                trackLayout: row['Track-Layout'] || '',
                car: row['Car_Name'] || '',
                purpleSector1: row['Purple_Sector_1'] === 'TRUE' || row['Purple_Sector_1'] === true,
                purpleSector2: row['Purple_Sector_2'] === 'TRUE' || row['Purple_Sector_2'] === true,
                purpleSector3: row['Purple_Sector_3'] === 'TRUE' || row['Purple_Sector_3'] === true
            }));
        
        const roundGroups = {};
        allData.forEach(row => {
            const r = row.round != null ? row.round : 'Unknown';
            if (!roundGroups[r]) {
                roundGroups[r] = [];
            }
            roundGroups[r].push(row);
        });
        
        Object.keys(roundGroups).forEach(round => {
            roundGroups[round].sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                if (b.purpleSectors !== a.purpleSectors) return b.purpleSectors - a.purpleSectors;
                return a.timestamp - b.timestamp;
            });
        });
        
        displayRoundData(roundGroups, tracksMap, carsMap);
        
    } catch (error) {
        console.error('Error loading round data:', error);
        const el = document.getElementById('round-loading');
        if (el) el.innerHTML = '<p style="color: red;">Error loading round data</p>';
    }
}

function displayRoundData(roundGroups, tracksMap, carsMap) {
    const container = document.getElementById('round-content');
    if (!container) return;
    container.innerHTML = '';

    const fallbackTrackImage = 'https://static.vecteezy.com/system/resources/previews/015/114/628/non_2x/race-track-icon-isometric-road-circuit-vector.jpg';
    const fallbackCarImage = 'https://thumb.silhouette-ac.com/t/e9/e9f1eb16ae292f36be10def00d95ecbb_t.jpeg';
    
    const sortedRounds = Object.keys(roundGroups).sort((a, b) => {
        const numA = parseInt(a.toString().replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.toString().replace(/\D/g, ''), 10) || 0;
        return numA - numB;
    });
    
    sortedRounds.forEach(round => {
        const results = roundGroups[round];
        const trackLayout = results[0] ? (results[0].trackLayout || '') : '';
        const car = results[0] ? (results[0].car || '') : '';
        
        const trackImage = tracksMap[trackLayout] || fallbackTrackImage;
        const carImage = carsMap[car] || fallbackCarImage;
        
        const summary = results.map(r => 
            `${r.driver} - P${r.position} - ${r.points}pts`
        ).join(' | ');
        
        const roundDiv = document.createElement('div');
        roundDiv.className = 'round-group';
        
        const header = document.createElement('div');
        header.className = 'round-header';
        header.onclick = () => toggleRound(round);
        header.innerHTML = `
            <div style="flex: 1;">
                <h3>Round ${round}</h3>
                <div class="round-summary">${summary}</div>
            </div>
            <div class="round-banner-icons">
                <div class="round-banner-icon">
                    <img src="${trackImage}" alt="${trackLayout}" onerror="this.src='${fallbackTrackImage}'">
                    <p>${trackLayout}</p>
                </div>
                <div class="round-banner-icon">
                    <img src="${carImage}" alt="${car}" onerror="this.src='${fallbackCarImage}'">
                    <p>${car}</p>
                </div>
            </div>
            <span class="toggle-icon" id="toggle-${round}">▼</span>
        `;
        
        const details = document.createElement('div');
        details.className = 'round-details';
        details.id = `details-${round}`;
        
        const table = document.createElement('table');
        table.className = 'leaderboard-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Driver</th>
                    <th>Sector 1</th>
                    <th>Sector 2</th>
                    <th>Sector 3</th>
                    <th>Total Time</th>
                    <th>Position</th>
                    <th>Purple Sectors</th>
                    <th>Points</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        
        const tbody = table.querySelector('tbody');
        results.forEach((row, index) => {
            const tr = document.createElement('tr');
            if (row.position === 1) tr.classList.add('position-1');
            if (row.position === 2) tr.classList.add('position-2');
            if (row.position === 3) tr.classList.add('position-3');
            
            const formattedName = getFormattedDriverName(row.driver);
            
            // Format sector times with purple highlighting
            const sector1Html = row.purpleSector1 
                ? `<span class="purple-sector">${formatTime(row.sector1)}</span>` 
                : formatTime(row.sector1);
            const sector2Html = row.purpleSector2 
                ? `<span class="purple-sector">${formatTime(row.sector2)}</span>` 
                : formatTime(row.sector2);
            const sector3Html = row.purpleSector3 
                ? `<span class="purple-sector">${formatTime(row.sector3)}</span>` 
                : formatTime(row.sector3);
            
            tr.innerHTML = `
                <td data-label="Driver">
                    <strong 
                        class="driver-link-round" 
                        data-driver="${row.driver}" 
                        style="cursor: pointer; color: #667eea;"
                    >
                        ${formattedName || row.driver}
                    </strong>
                </td>
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
        container.appendChild(roundDiv);
    });
    
    const loading = document.getElementById('round-loading');
    const content = document.getElementById('round-content');
    if (loading) loading.style.display = 'none';
    if (content) content.style.display = 'block';

    setTimeout(() => {
        document.querySelectorAll('.driver-link-round').forEach(link => {
            link.addEventListener('click', function(e) {
                e.stopPropagation();
                const driverName = this.getAttribute('data-driver');
                goToDriverProfile(driverName);
            });
        });
    }, 100);
}

function toggleRound(round) {
    const details = document.getElementById(`details-${round}`);
    const icon = document.getElementById(`toggle-${round}`);
    if (!details) return;
    details.classList.toggle('expanded');
    if (icon) icon.classList.toggle('expanded');
}

// Load Driver Stats
async function loadDriverStats() {
    const roundDataRef = window.firebaseRef(window.firebaseDB, 'Round_Data');
    const leaderboardRef = window.firebaseRef(window.firebaseDB, 'Leaderboard');
    
    try {
        const [roundSnapshot, leaderboardSnapshot] = await Promise.all([
            window.firebaseGet(roundDataRef),
            window.firebaseGet(leaderboardRef)
        ]);
        
        const roundData = asArray(roundSnapshot.val());
        const leaderboardData = asArray(leaderboardSnapshot.val());
        
        // Get unique drivers (from leaderboard first, fallback to roundData)
        let drivers = [];
        try {
            drivers = [...new Set(leaderboardData.map(r => r.Driver).filter(Boolean))];
        } catch (e) {
            drivers = [...new Set(roundData.map(r => r.Driver).filter(Boolean))];
        }
        
        const driversContent = document.getElementById('drivers-content');
        if (!driversContent) return;
        driversContent.innerHTML = '';
        
        drivers.forEach(driverName => {
            const driverRoundData = roundData.filter(r => r && r.Driver === driverName);
            const driverLeaderboard = leaderboardData.find(l => l && l.Driver === driverName) || {};
            
            const totalPoints = parseInt(driverLeaderboard['Total_Points']) || 0;
            const totalPurpleSectors = parseInt(driverLeaderboard['Total_Purple_Sectors']) || 0;
            const totalWins = parseInt(driverLeaderboard['Total_Wins']) || 0;
            
            const totalRounds = driverRoundData.length;
            const avgPosition = totalRounds > 0 
                ? (driverRoundData.reduce((sum, r) => {
                    const pos = parseInt(r.Position, 10);
                    return sum + (isFinite(pos) ? pos : 0);
                }, 0) / totalRounds).toFixed(1)
                : 'N/A';
            
            // Calculate Personal Best Lap (choose smallest numeric Total_Lap_Time)
            let personalBest = null;
            if (driverRoundData.length > 0) {
                personalBest = driverRoundData.reduce((best, current) => {
                    const currentTime = lapTimeToSeconds(current['Total_Lap_Time']);
                    const bestTime = best ? lapTimeToSeconds(best['Total_Lap_Time']) : NaN;
                    if (isFinite(currentTime) && (!isFinite(bestTime) || currentTime < bestTime)) {
                        return current;
                    }
                    return best;
                }, null);
            }
            
            // Calculate Track + Car Records (unique combinations with best times)
            const trackCarRecords = {};
            driverRoundData.forEach(record => {
                const key = `${record['Track-Layout'] || ''} - ${record['Car_Name'] || ''}`;
                const timeSec = lapTimeToSeconds(record['Total_Lap_Time']);
                const currentBest = trackCarRecords[key];
                if (!currentBest || (isFinite(timeSec) && timeSec < currentBest.time)) {
                    trackCarRecords[key] = {
                        combo: key,
                        time: isFinite(timeSec) ? timeSec : Infinity,
                        timeFormatted: formatTime(record['Total_Lap_Time'])
                    };
                }
            });
            const trackCarRecordsArray = Object.values(trackCarRecords).sort((a, b) => a.time - b.time);
            
            // Calculate Favorite Track (most appearances)
            const trackCounts = {};
            driverRoundData.forEach(r => {
                const track = r['Track-Layout'];
                if (track) {
                    trackCounts[track] = (trackCounts[track] || 0) + 1;
                }
            });
            const favoriteTrack = Object.keys(trackCounts).length > 0 
                ? Object.keys(trackCounts).reduce((a, b) => (trackCounts[a] > trackCounts[b] ? a : b))
                : 'N/A';
            
            // Calculate Favorite Car (most appearances)
            const carCounts = {};
            driverRoundData.forEach(r => {
                const car = r['Car_Name'];
                if (car) {
                    carCounts[car] = (carCounts[car] || 0) + 1;
                }
            });
            const favoriteCar = Object.keys(carCounts).length > 0
                ? Object.keys(carCounts).reduce((a, b) => (carCounts[a] > carCounts[b] ? a : b))
                : 'N/A';
            
            // Calculate Head-to-Head Records
            const h2hRecords = {};
            const allDrivers = [...new Set(asArray(roundData).map(r => r.Driver))].filter(d => d && d !== driverName);
            
            allDrivers.forEach(opponent => {
                const sharedRounds = {};
                
                // Group by round (only include rounds that have both drivers)
                asArray(roundData).forEach(r => {
                    if (!r || r.Round == null) return;
                    const roundKey = r.Round;
                    if (!sharedRounds[roundKey]) sharedRounds[roundKey] = {};
                    if (r.Driver === driverName || r.Driver === opponent) {
                        const pos = parseInt(r.Position, 10);
                        sharedRounds[roundKey][r.Driver] = isFinite(pos) ? pos : null;
                    }
                });
                
                // Count wins/losses
                let wins = 0;
                let losses = 0;
                Object.values(sharedRounds).forEach(roundObj => {
                    const posA = roundObj[driverName];
                    const posB = roundObj[opponent];
                    if (posA != null && posB != null) { // explicit null/undefined check
                        if (posA < posB) wins++;
                        else if (posA > posB) losses++;
                    }
                });
                
                if (wins > 0 || losses > 0) {
                    h2hRecords[opponent] = { wins, losses };
                }
            });
            
            // Get profile info
            let profile = null;
            for (const loginName in ALLOWED_USERS) {
                if (loginName === driverName) {
                    const email = ALLOWED_USERS[loginName]?.email;
                    if (email && DRIVER_PROFILES[email]) {
                        profile = DRIVER_PROFILES[email];
                        break;
                    }
                }
            }
            
            const formattedName = profile && profile.surname 
                ? `${profile.name} ${profile.surname}` 
                : driverName;
            
            const formattedShortName = profile && profile.surname 
                ? `${profile.name.charAt(0)}. ${profile.surname}` 
                : driverName;
            
            // Championship position: robust handling
            let championshipPosition = 'N/A';
            const idx = leaderboardData.findIndex(l => l && l.Driver === driverName);
            championshipPosition = idx >= 0 ? idx + 1 : 'N/A';
            
            const card = document.createElement('div');
            card.className = 'driver-card';
            card.setAttribute('data-driver', driverName);
            
            let photoHtml = '';
            if (profile && profile.photoUrl) {
                let photoUrl = extractDriveThumbnail(profile.photoUrl) || profile.photoUrl;
                photoHtml = `
                    <div class="driver-photo-container-mobile">
                        <img src="${photoUrl}" alt="${formattedName}" class="driver-photo-mobile">
                        <div class="driver-number-badge-mobile">${profile.number || '?'}</div>
                    </div>
                `;
            }
            
            // Build Track + Car Records HTML
            let trackCarRecordsHtml = '';
            if (trackCarRecordsArray.length > 0) {
                trackCarRecordsHtml = trackCarRecordsArray.map(record => `
                    <div class="record-item">
                        <span>${record.combo}</span>
                        <strong>${record.timeFormatted}</strong>
                    </div>
                `).join('');
            } else {
                trackCarRecordsHtml = '<p style="color: #999; text-align: center;">No records yet</p>';
            }
            
            // Build Head-to-Head HTML
            let h2hHtml = '';
            const h2hEntries = Object.entries(h2hRecords);
            if (h2hEntries.length > 0) {
                h2hHtml = h2hEntries.map(([opponent, record]) => {
                    const opponentFormatted = getFormattedDriverName(opponent);
                    return `
                        <div class="h2h-card">
                            <div class="opponent">vs ${opponentFormatted}</div>
                            <div class="record">${record.wins}W - ${record.losses}L</div>
                        </div>
                    `;
                }).join('');
            } else {
                h2hHtml = '<p style="color: #999; text-align: center;">No head-to-head data yet</p>';
            }
            
            card.innerHTML = `
                <div class="driver-header-mobile">
                    ${photoHtml}
                    <div class="driver-name-mobile">${formattedShortName}</div>
                    <div class="driver-stats-compact">
                        <div class="stat-compact-item">
                            <span class="stat-compact-label">Championship Position:</span>
                            <span class="stat-compact-value">${championshipPosition}</span>
                        </div>
                        <div class="stat-compact-row">
                            <div class="stat-compact-item">
                                <span class="stat-compact-label">Total Points:</span>
                                <span class="stat-compact-value">${totalPoints}</span>
                            </div>
                            <div class="stat-compact-item">
                                <span class="stat-compact-label">Races:</span>
                                <span class="stat-compact-value">${totalRounds}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="stats-grid-driver">
                    <div class="stat-card-driver">
                        <h3>Total Points</h3>
                        <p class="stat-value">${totalPoints}</p>
                    </div>
                    <div class="stat-card-driver">
                        <h3>Wins</h3>
                        <p class="stat-value">${totalWins}</p>
                    </div>
                    <div class="stat-card-driver">
                        <h3>Purple Sectors</h3>
                        <p class="stat-value">${totalPurpleSectors}</p>
                    </div>
                    <div class="stat-card-driver">
                        <h3>Avg Position</h3>
                        <p class="stat-value">${avgPosition}</p>
                    </div>
                </div>
                
                ${profile && profile.bio ? `<p style="text-align: center; color: #666; margin: 20px 0; font-style: italic;">"${profile.bio}"</p>` : ''}
                
                <div class="driver-records-section">
                    <h3 class="section-title">🏆 Lap Time Records</h3>
                    <div class="lap-records">
                        <div class="personal-best">
                            <strong style="color: #667eea;">Personal Best Lap:</strong>
                            <div style="font-size: 1.5em; font-weight: bold; color: #2c3e50; margin: 5px 0;">
                                ${personalBest ? formatTime(personalBest['Total_Lap_Time']) : 'N/A'}
                            </div>
                            ${personalBest ? `
                                <div style="font-size: 0.9em; color: #666;">
                                    ${personalBest['Track-Layout'] || ''}<br>
                                    ${personalBest['Car_Name'] || ''}
                                </div>
                            ` : ''}
                        </div>
                        <div class="quick-stats">
                            <div class="quick-stat-item">
                                <strong style="color: #667eea;">Purple Sectors:</strong> ${totalPurpleSectors}
                            </div>
                            <div class="quick-stat-item">
                                <strong style="color: #667eea;">Favorite Track:</strong> ${favoriteTrack}
                            </div>
                            <div class="quick-stat-item">
                                <strong style="color: #667eea;">Favorite Car:</strong> ${favoriteCar}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="driver-records-section">
                    <h3 class="section-title">📍 Track + Car Records</h3>
                    <div class="track-car-records">
                        ${trackCarRecordsHtml}
                    </div>
                </div>
                
                <div class="driver-records-section">
                    <h3 class="section-title">⚔️ Head-to-Head Record</h3>
                    <div class="h2h-grid">
                        ${h2hHtml}
                    </div>
                </div>
            `;
            
            driversContent.appendChild(card);
        });
        
        const loadingEl = document.getElementById('drivers-loading');
        const contentEl = document.getElementById('drivers-content');
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
        
    } catch (error) {
        console.error('Error loading driver stats:', error);
        const el = document.getElementById('drivers-loading');
        if (el) el.innerHTML = '<p style="color: red;">Error loading driver statistics</p>';
    }
}

// Load Profile
async function loadProfile() {
    const profileContent = document.getElementById('profileContent');
    const profileWarning = document.getElementById('profileAuthWarning');
    
    if (!currentUser) {
        if (profileWarning) profileWarning.style.display = 'block';
        if (profileContent) profileContent.style.display = 'none';
        return;
    }
    
    if (profileWarning) profileWarning.style.display = 'none';
    if (profileContent) profileContent.style.display = 'block';
    
    // Load existing profile data
    const profile = DRIVER_PROFILES[currentUser.email] || {};
    
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setVal('profileName', profile.name || '');
    setVal('profileSurname', profile.surname || '');
    setVal('profileNumber', profile.number || '');
    setVal('profilePhotoUrl', profile.photoUrl || '');
    setVal('profileBio', profile.bio || '');
    
    // Show photo preview if exists
    if (profile.photoUrl) {
        let photoUrl = extractDriveThumbnail(profile.photoUrl) || profile.photoUrl;
        const img = document.getElementById('photoPreviewImg');
        if (img) img.src = photoUrl;
        const preview = document.getElementById('photoPreview');
        if (preview) preview.style.display = 'block';
    }
}

// Profile form submission
const profileFormEl = document.getElementById('profileForm');
if (profileFormEl) {
    profileFormEl.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        if (!currentUser) {
            alert('Please sign in to update your profile');
            return;
        }
        
        const messageDiv = document.getElementById('profileMessage');
        if (!messageDiv) return;
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#d1ecf1';
        messageDiv.style.color = '#0c5460';
        messageDiv.textContent = '⏳ Saving profile...';
        
        try {
            const profileData = {
                Email: currentUser.email,
                Name: document.getElementById('profileName').value.trim(),
                Surname: document.getElementById('profileSurname').value.trim(),
                Number: document.getElementById('profileNumber').value,
                Photo_URL: document.getElementById('profilePhotoUrl').value.trim(),
                Bio: document.getElementById('profileBio').value.trim()
            };
            
            // Find existing profile or create new
            const profilesRef = window.firebaseRef(window.firebaseDB, 'Driver_Profiles');
            const profilesSnapshot = await window.firebaseGet(profilesRef);
            const profilesDataRaw = profilesSnapshot.val() || [];
            const profilesData = asArray(profilesDataRaw);
            
            const existingIndex = profilesData.findIndex(p => p && p.Email === currentUser.email);
            
            if (existingIndex >= 0) {
                // Update existing profile (use index path because original code used array indices)
                const profileRef = window.firebaseRef(window.firebaseDB, `Driver_Profiles/${existingIndex}`);
                await window.firebaseSet(profileRef, profileData);
            } else {
                // Create new profile
                await window.firebasePush(profilesRef, profileData);
            }
            
            // Update local cache
            DRIVER_PROFILES[currentUser.email] = {
                name: profileData.Name,
                surname: profileData.Surname,
                number: profileData.Number != null ? profileData.Number.toString() : '',
                photoUrl: profileData.Photo_URL,
                bio: profileData.Bio
            };
            
            messageDiv.style.background = '#d4edda';
            messageDiv.style.color = '#155724';
            messageDiv.textContent = '✅ Profile saved successfully!';
            
            setTimeout(() => {
                messageDiv.style.display = 'none';
                
                // Update user info display
                const profile = DRIVER_PROFILES[currentUser.email];
                const photoContainer = document.getElementById('userPhotoContainer');
                const photoElement = document.getElementById('userProfilePhoto');
                const numberBadge = document.getElementById('userNumberBadge');
                const iconFallback = document.getElementById('userIconFallback');
                
                if (profile && profile.photoUrl) {
                    let photoUrl = extractDriveThumbnail(profile.photoUrl) || profile.photoUrl;
                    if (photoElement) photoElement.src = photoUrl;
                    if (numberBadge) numberBadge.textContent = profile.number || '?';
                    if (photoContainer) photoContainer.style.display = 'block';
                    if (iconFallback) iconFallback.style.display = 'none';
                }
            }, 2000);
            
        } catch (error) {
            console.error('Error saving profile:', error);
            messageDiv.style.background = '#f8d7da';
            messageDiv.style.color = '#721c24';
            messageDiv.textContent = '❌ Error: ' + (error.message || 'Unknown');
        }
    });
}

// Photo file input handler
const photoFileEl = document.getElementById('photoFile');
if (photoFileEl) {
    photoFileEl.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = document.getElementById('photoPreviewImg');
            if (img) img.src = e.target.result;
            const preview = document.getElementById('photoPreview');
            if (preview) preview.style.display = 'block';
            
            alert('⚠️ Photo upload to storage not yet implemented. Please upload to Google Drive and paste the sharing link in the Photo URL field.');
        };
        reader.readAsDataURL(file);
    });
}

// Event listeners on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
    const passwordInput = document.getElementById('passwordInput');
    const driverNameInput = document.getElementById('driverNameInput');
    
    if (passwordInput) {
        passwordInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                login();
            }
        });
    }
    
    if (driverNameInput) {
        driverNameInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                login();
            }
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
