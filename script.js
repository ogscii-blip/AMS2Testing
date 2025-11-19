// Tab switching functionality
function showTab(tabName) {
    // Hide all tabs
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Remove active class from all buttons
    const buttons = document.querySelectorAll('.tab-button');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    // Show selected tab
    document.getElementById(tabName).classList.add('active');
    
    // Add active class to clicked button
    event.target.classList.add('active');
    
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
            card.scrollIntoView({ behavior: "smooth", block: "start" });
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
    let profile = null;
    
    for (const loginName in ALLOWED_USERS) {
        if (loginName === driverLoginName) {
            const email = ALLOWED_USERS[loginName].email;
            if (DRIVER_PROFILES[email]) {
                profile = DRIVER_PROFILES[email];
                break;
            }
        }
    }
    
    if (profile && profile.surname && profile.number) {
        return `${profile.name.charAt(0)}. ${profile.surname} - ${profile.number}`;
    }
    
    return driverLoginName;
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
        const configData = snapshot.val();
        if (!configData) return;

        const configMap = {};
        configData.forEach(row => {
            const setting = row['Setting']?.trim();
            const value = row['Value']?.trim();
            if (setting && value) {
                configMap[setting] = value;
            }
        });

        APPS_SCRIPT_URL = configMap['apps_script_url'];

        for (let i = 1; i <= 10; i++) {
            const name = configMap['allowed_name_' + i];
            const email = configMap['allowed_email_' + i];
            const password = configMap['allowed_password_' + i];
            
            if (name && email && password) {
                ALLOWED_USERS[name] = { email, password };
            }
        }

        console.log('Config loaded from Firebase:', Object.keys(ALLOWED_USERS).length, 'users');
    });

    const profilesRef = window.firebaseRef(window.firebaseDB, 'Driver_Profiles');
    window.firebaseOnValue(profilesRef, (snapshot) => {
        const profilesData = snapshot.val();
        if (!profilesData) return;

        DRIVER_PROFILES = {};
        profilesData.forEach(profile => {
            const email = profile['Email']?.trim();
            if (email) {
                DRIVER_PROFILES[email] = {
                    name: profile['Name']?.trim() || '',
                    surname: profile['Surname']?.trim() || '',
                    number: profile['Number']?.toString() || '',
                    photoUrl: profile['Photo_URL']?.trim() || '',
                    bio: profile['Bio']?.trim() || ''
                };
            }
        });

        console.log('Driver profiles loaded from Firebase:', Object.keys(DRIVER_PROFILES).length);
    });
}

// Load leaderboard with season filter
async function loadLeaderboard() {
    const seasonSelect = document.getElementById('seasonSelect');
    const selectedSeason = seasonSelect ? seasonSelect.value : '';
    
    const leaderboardRef = window.firebaseRef(window.firebaseDB, 'Leaderboard');
    
    window.firebaseGet(leaderboardRef).then((snapshot) => {
        const leaderboardData = snapshot.val();
        if (!leaderboardData) {
            console.log('No leaderboard data found');
            return;
        }

        let data = leaderboardData.filter(row => row.Driver);
        
        // Apply season filter if selected
        if (selectedSeason) {
            data = data.filter(row => row.Season == selectedSeason);
        }
        
        data = data
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
        
        document.getElementById('totalDrivers').textContent = data.length;
        const totalPoints = data.reduce((sum, driver) => sum + driver.points, 0);
        document.getElementById('totalPoints').textContent = totalPoints;
        
        loadRoundsCount();
        populateSeasonFilter();
    });
}

// Populate season dropdown
async function populateSeasonFilter() {
    const setupRef = window.firebaseRef(window.firebaseDB, 'Form_responses_2');
    window.firebaseGet(setupRef).then((snapshot) => {
        const setupDataRaw = snapshot.val();
        if (!setupDataRaw) return;
        
        // Convert to array if it's an object
        let setupDataArray = [];
        if (Array.isArray(setupDataRaw)) {
            setupDataArray = setupDataRaw;
        } else {
            setupDataArray = Object.values(setupDataRaw);
        }
        
        const seasons = [...new Set(setupDataArray.map(s => s.Season))].filter(s => s).sort((a, b) => a - b);
        
        const seasonSelect = document.getElementById('seasonSelect');
        const currentValue = seasonSelect.value;
        
        seasonSelect.innerHTML = '<option value="">All Seasons</option>';
        seasons.forEach(season => {
            const option = document.createElement('option');
            option.value = season;
            option.textContent = `Season ${season}`;
            seasonSelect.appendChild(option);
        });
        
        seasonSelect.value = currentValue;
    });
}

async function loadRoundsCount() {
    const roundDataRef = window.firebaseRef(window.firebaseDB, 'Round_Data');
    window.firebaseGet(roundDataRef).then((snapshot) => {
        const roundData = snapshot.val();
        if (roundData) {
            const rounds = [...new Set(roundData.map(r => r.Round))];
            document.getElementById('totalRounds').textContent = rounds.length;
        }
    });
}

function displayLeaderboard(data) {
    const tbody = document.getElementById('leaderboard-body');
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
        link.addEventListener('click', function() {
            const driverName = this.getAttribute('data-driver');
            goToDriverCurrentRound(driverName);
        });
    });
    
    document.getElementById('leaderboard-loading').style.display = 'none';
    document.getElementById('leaderboard-content').style.display = 'block';
}

// Load round data
async function loadRoundData() {
    const roundDataRef = window.firebaseRef(window.firebaseDB, 'Round_Data');
    const tracksRef = window.firebaseRef(window.firebaseDB, 'Tracks');
    const carsRef = window.firebaseRef(window.firebaseDB, 'Cars');
    const setupRef = window.firebaseRef(window.firebaseDB, 'Form_responses_2');
    
    try {
        const [roundSnapshot, tracksSnapshot, carsSnapshot, setupSnapshot] = await Promise.all([
            window.firebaseGet(roundDataRef),
            window.firebaseGet(tracksRef),
            window.firebaseGet(carsRef),
            window.firebaseGet(setupRef)
        ]);
        
        const roundData = roundSnapshot.val() || [];
        const tracksData = tracksSnapshot.val() || [];
        const carsData = carsSnapshot.val() || [];
        
        // Convert setupData to array for season dropdown
        let setupDataRaw = setupSnapshot.val();
        let setupDataArray = [];
        if (setupDataRaw) {
            if (Array.isArray(setupDataRaw)) {
                setupDataArray = setupDataRaw;
            } else {
                setupDataArray = Object.values(setupDataRaw);
            }
        }
        
        // Populate season dropdown
        const seasons = [...new Set(setupDataArray.map(s => s.Season))].filter(s => s).sort((a, b) => a - b);
        const roundSeasonSelect = document.getElementById('roundSeasonSelect');
        const currentSeasonValue = roundSeasonSelect.value;
        
        roundSeasonSelect.innerHTML = '<option value="">All Seasons</option>';
        seasons.forEach(season => {
            const option = document.createElement('option');
            option.value = season;
            option.textContent = `Season ${season}`;
            roundSeasonSelect.appendChild(option);
        });
        roundSeasonSelect.value = currentSeasonValue;
        
        const tracksMap = {};
        tracksData.forEach(row => {
            const trackCombo = row['Track_Combos'];
            const trackImage = row['Track_Image_URL'];
            if (trackCombo) {
                tracksMap[trackCombo.trim()] = trackImage || 'https://via.placeholder.com/60x60?text=Track';
            }
        });
        
        const carsMap = {};
        carsData.forEach(row => {
            const carName = row['Car_Name'];
            const carImage = row['Car_Image_URL'];
            if (carName) {
                carsMap[carName.trim()] = carImage || 'https://via.placeholder.com/60x60?text=Car';
            }
        });
        
        // Filter by selected season
        const selectedSeason = roundSeasonSelect.value;
        let filteredRoundData = roundData;
        if (selectedSeason) {
            filteredRoundData = roundData.filter(row => row.Season == selectedSeason);
        }
        
        const allData = filteredRoundData
            .filter(row => row.Driver && row.Position)
            .map((row, index) => {
                // Parse purple sector values - handle string "TRUE" or boolean true
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
                    timestamp: index,
                    trackLayout: row['Track-Layout'] || '',
                    car: row['Car_Name'] || '',
                    season: row.Season,
                    purpleSector1: purpleSector1,
                    purpleSector2: purpleSector2,
                    purpleSector3: purpleSector3
                };
            });
        
        const roundGroups = {};
        allData.forEach(row => {
            const key = `S${row.season}-R${row.round}`;
            if (!roundGroups[key]) {
                roundGroups[key] = {
                    season: row.season,
                    round: row.round,
                    results: []
                };
            }
            roundGroups[key].results.push(row);
        });
        
        // Calculate purple sectors for each round
        Object.keys(roundGroups).forEach(key => {
            const results = roundGroups[key].results;
            
            // Find fastest sector times in this round
            const fastestSector1 = Math.min(...results.map(r => parseFloat(r.sector1) || Infinity));
            const fastestSector2 = Math.min(...results.map(r => parseFloat(r.sector2) || Infinity));
            const fastestSector3 = Math.min(...results.map(r => parseFloat(r.sector3) || Infinity));
            
            // Mark purple sectors
            results.forEach(result => {
                result.purpleSector1 = parseFloat(result.sector1) === fastestSector1;
                result.purpleSector2 = parseFloat(result.sector2) === fastestSector2;
                result.purpleSector3 = parseFloat(result.sector3) === fastestSector3;
            });
            
            // Sort results
            roundGroups[key].results.sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                if (b.purpleSectors !== a.purpleSectors) return b.purpleSectors - a.purpleSectors;
                return a.timestamp - b.timestamp;
            });
        });
        
        displayRoundData(roundGroups, tracksMap, carsMap);
        
    } catch (error) {
        console.error('Error loading round data:', error);
    }
}

function displayRoundData(roundGroups, tracksMap, carsMap) {
    const container = document.getElementById('round-content');
    container.innerHTML = '';

    const fallbackTrackImage = 'https://static.vecteezy.com/system/resources/previews/015/114/628/non_2x/race-track-icon-isometric-road-circuit-vector.jpg';
    const fallbackCarImage = 'https://thumb.silhouette-ac.com/t/e9/e9f1eb16ae292f36be10def00d95ecbb_t.jpeg';
    
    const sortedRounds = Object.keys(roundGroups).sort((a, b) => {
        const [seasonA, roundA] = a.replace('S', '').split('-R').map(Number);
        const [seasonB, roundB] = b.replace('S', '').split('-R').map(Number);
        if (seasonA !== seasonB) return seasonA - seasonB;
        return roundA - roundB;
    });
    
    sortedRounds.forEach(key => {
        const roundGroup = roundGroups[key];
        const results = roundGroup.results;
        const season = roundGroup.season;
        const round = roundGroup.round;
        
        const trackLayout = results[0].trackLayout?.trim() || '';
        const car = results[0].car?.trim() || '';
        
        const trackImage = tracksMap[trackLayout] || fallbackTrackImage;
        const carImage = carsMap[car] || fallbackCarImage;
        
        const summary = results.map(r => 
            `${r.driver} - P${r.position} - ${r.points}pts`
        ).join(' | ');
        
        const roundDiv = document.createElement('div');
        roundDiv.className = 'round-group';
        
        const header = document.createElement('div');
        header.className = 'round-header';
        header.onclick = () => toggleRound(key);
        header.innerHTML = `
            <div style="flex: 1;">
                <h3>Round ${round} - Season ${season}</h3>
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
            <span class="toggle-icon" id="toggle-${key}">▼</span>
        `;
        
        const details = document.createElement('div');
        details.className = 'round-details';
        details.id = `details-${key}`;
        
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
    
    document.getElementById('round-loading').style.display = 'none';
    document.getElementById('round-content').style.display = 'block';

    setTimeout(() => {
        document.querySelectorAll('.driver-link-round').forEach(link => {
            link.addEventListener('click', function(e) {
                e.stopPropagation();
                const driverName = this.getAttribute('data-driver');
                goToDriverProfile(driverName);
            });
        });
    }, 100);
    
    // Auto-expand the latest round
    if (sortedRounds.length > 0) {
        const latestRound = sortedRounds[sortedRounds.length - 1];
        setTimeout(() => {
            const details = document.getElementById(`details-${latestRound}`);
            const icon = document.getElementById(`toggle-${latestRound}`);
            if (details && icon) {
                details.classList.add('expanded');
                icon.classList.add('expanded');
                console.log(`Auto-expanded ${latestRound}`);
            }
        }, 200);
    }
}
function toggleRound(round) {
    const details = document.getElementById(`details-${round}`);
    const icon = document.getElementById(`toggle-${round}`);
    details.classList.toggle('expanded');
    icon.classList.toggle('expanded');
}

function formatTime(seconds) {
    if (!seconds || seconds === "") return "";
    const totalSeconds = parseFloat(seconds);
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
    const parts = timeStr.split(':');
    const minutes = parseInt(parts[0]);
    const secondsParts = parts[1].split(',');
    const seconds = parseInt(secondsParts[0]);
    const milliseconds = parseInt(secondsParts[1]);
    return minutes * 60 + seconds + (milliseconds / 1000);
}

// Authentication functions
function login() {
    const driverName = document.getElementById('driverNameInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    
    if (!driverName || !password) {
        alert('⚠️ Please enter both driver name and password.');
        return;
    }
    
    if (!ALLOWED_USERS[driverName]) {
        alert('⛔ Access Denied\n\nDriver name "' + driverName + '" is not authorized.');
        return;
    }
    
    const storedPassword = ALLOWED_USERS[driverName].password;
    
    if (password !== storedPassword) {
        alert('⛔ Incorrect password for ' + driverName + '. Please try again.');
        return;
    }
    
    currentUser = {
        name: driverName,
        email: ALLOWED_USERS[driverName].email
    };
    
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('userInfo').style.display = 'block';
    document.getElementById('userName').textContent = currentUser.name;
    
    const profile = DRIVER_PROFILES[currentUser.email];
    const photoContainer = document.getElementById('userPhotoContainer');
    const photoElement = document.getElementById('userProfilePhoto');
    const numberBadge = document.getElementById('userNumberBadge');
    const iconFallback = document.getElementById('userIconFallback');
    
    if (profile && profile.photoUrl) {
        let photoUrl = profile.photoUrl;
        if (photoUrl.includes('drive.google.com/uc?id=')) {
            const fileId = photoUrl.split('id=')[1];
            photoUrl = `https://lh3.googleusercontent.com/d/${fileId}=s200`;
        }
        photoElement.src = photoUrl;
        numberBadge.textContent = profile.number || '?';
        photoContainer.style.display = 'block';
        iconFallback.style.display = 'none';
    } else {
        photoContainer.style.display = 'none';
        iconFallback.style.display = 'block';
    }
    
    sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
    updateSubmitTabVisibility();
}

function signOut() {
    currentUser = null;
    sessionStorage.removeItem('currentUser');
    
    document.getElementById('loginForm').style.display = 'flex';
    document.getElementById('userInfo').style.display = 'none';
    document.getElementById('driverNameInput').value = '';
    document.getElementById('passwordInput').value = '';
    
    updateSubmitTabVisibility();
}

function updateSubmitTabVisibility() {
    const submitTab = document.querySelector('.tab-button[onclick*="submit"]');
    const setupTab = document.querySelector('.tab-button[onclick*="setup"]');
    
    if (currentUser) {
        document.getElementById('authWarning').style.display = 'none';
        document.getElementById('lapTimeFormContainer').style.display = 'block';
        if (submitTab) submitTab.style.display = 'block';
        if (setupTab) setupTab.style.display = 'block';
    } else {
        document.getElementById('authWarning').style.display = 'block';
        document.getElementById('lapTimeFormContainer').style.display = 'none';
        if (submitTab) submitTab.style.display = 'none';
        if (setupTab) setupTab.style.display = 'none';
    }
}

async function checkExistingSession() {
    const storedUser = sessionStorage.getItem('currentUser');
    
    if (storedUser) {
        currentUser = JSON.parse(storedUser);
        
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('userInfo').style.display = 'block';
        document.getElementById('userName').textContent = currentUser.name;
        
        await new Promise(resolve => {
            const checkProfiles = setInterval(() => {
                if (Object.keys(DRIVER_PROFILES).length > 0) {
                    clearInterval(checkProfiles);
                    resolve();
                }
            }, 100);
            
            setTimeout(() => {
                clearInterval(checkProfiles);
                resolve();
            }, 3000);
        });
        
        const profile = DRIVER_PROFILES[currentUser.email];
        const photoContainer = document.getElementById('userPhotoContainer');
        const photoElement = document.getElementById('userProfilePhoto');
        const numberBadge = document.getElementById('userNumberBadge');
        const iconFallback = document.getElementById('userIconFallback');
        
        if (profile && profile.photoUrl) {
            let photoUrl = profile.photoUrl;
            if (photoUrl.includes('drive.google.com/uc?id=')) {
                const fileId = photoUrl.split('id=')[1];
                photoUrl = `https://lh3.googleusercontent.com/d/${fileId}=s200`;
            }
            photoElement.src = photoUrl;
            numberBadge.textContent = profile.number || '?';
            photoContainer.style.display = 'block';
            iconFallback.style.display = 'none';
        } else {
            photoContainer.style.display = 'none';
            iconFallback.style.display = 'block';
        }
        
        updateSubmitTabVisibility();
    }
}

// Sector time input handling
function setupSectorTimeInputs() {
    const sectorInputs = ['sector1', 'sector2', 'sector3'];
    
    sectorInputs.forEach(inputId => {
        const secInput = document.getElementById(`${inputId}-sec`);
        const msInput = document.getElementById(`${inputId}-ms`);
        
        if (secInput && msInput) {
            [secInput, msInput].forEach(input => {
                input.addEventListener('input', function() {
                    this.value = this.value.replace(/[^0-9]/g, '');
                });
            });
            
            secInput.addEventListener('input', function() {
                if (this.value.length >= 2) {
                    msInput.focus();
                }
            });
            
            msInput.addEventListener('keydown', function(e) {
                if (e.key === 'Backspace' && this.value.length === 0 && this.selectionStart === 0) {
                    secInput.focus();
                    setTimeout(() => {
                        secInput.selectionStart = secInput.selectionEnd = secInput.value.length;
                    }, 0);
                }
            });
        }
    });
}

function getSectorTimeValue(sectorId) {
    const secInput = document.getElementById(`${sectorId}-sec`);
    const msInput = document.getElementById(`${sectorId}-ms`);
    
    if (!secInput || !msInput) {
        return '';
    }
    
    const seconds = secInput.value || '';
    const milliseconds = msInput.value || '';
    
    if (seconds === '' || milliseconds === '') {
        return '';
    }
    
    const paddedSeconds = seconds.padStart(2, '0');
    const paddedMilliseconds = milliseconds.padStart(3, '0');
    
    const totalSeconds = parseInt(paddedSeconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')},${paddedMilliseconds}`;
}

// Lap Time Submission - Cloud Functions handle calculations!
document.getElementById('lapTimeForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (!currentUser) {
        const messageDiv = document.getElementById('lapTimeMessage');
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.textContent = '❌ Please sign in to submit lap times.';
        return;
    }
    
    const seasonNumber = parseInt(document.getElementById('seasonNumber').value);
    const roundNumber = parseInt(document.getElementById('roundNumber2').value);
    const sector1 = getSectorTimeValue('sector1');
    const sector2 = getSectorTimeValue('sector2');
    const sector3 = getSectorTimeValue('sector3');
    
    const messageDiv = document.getElementById('lapTimeMessage');
    
    if (!sector1 || !sector2 || !sector3) {
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.textContent = '❌ Please fill in all sector times.';
        return;
    }
    
    const timePattern = /^\d{2}:\d{2},\d{3}$/;
    if (!timePattern.test(sector1) || !timePattern.test(sector2) || !timePattern.test(sector3)) {
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.textContent = '❌ Invalid time format.';
        return;
    }
    
    messageDiv.style.display = 'block';
    messageDiv.style.background = '#d1ecf1';
    messageDiv.style.color = '#0c5460';
    messageDiv.textContent = '⏳ Submitting lap time...';
    
    try {
        const sector1Seconds = timeToSeconds(sector1);
        const sector2Seconds = timeToSeconds(sector2);
        const sector3Seconds = timeToSeconds(sector3);
        const totalTime = sector1Seconds + sector2Seconds + sector3Seconds;
        
        // Get round setup
        const setupRef = window.firebaseRef(window.firebaseDB, 'Form_responses_2');
        const setupSnapshot = await window.firebaseGet(setupRef);
        
        // Convert to array if it's an object
        let setupDataRaw = setupSnapshot.val();
        let setupDataArray = [];
        if (setupDataRaw) {
            if (Array.isArray(setupDataRaw)) {
                setupDataArray = setupDataRaw;
            } else {
                setupDataArray = Object.values(setupDataRaw);
            }
        }
        
        const roundSetup = setupDataArray.find(s => 
            s && s.Round_Number == roundNumber && s.Season == seasonNumber
        );
        
        if (!roundSetup) {
            throw new Error(`Round ${roundNumber} Season ${seasonNumber} not configured!`);
        }
        
        // Create lap entry
        const lapTimeData = {
            Timestamp: new Date().toISOString(),
            Driver: currentUser.name,
            Season: seasonNumber,
            Round: roundNumber,
            Sector_1: sector1Seconds,
            Sector_2: sector2Seconds,
            Sector_3: sector3Seconds,
            Total_Lap_Time: totalTime,
            'Track-Layout': roundSetup['Track-Layout'],
            Car_Name: roundSetup.Car_Name
        };
        
        // Save to Firebase - Cloud Function calculates automatically!
        const lapTimesRef = window.firebaseRef(window.firebaseDB, 'Form_responses_1');
        await window.firebasePush(lapTimesRef, lapTimeData);
        
        messageDiv.style.background = '#d4edda';
        messageDiv.style.color = '#155724';
        messageDiv.textContent = `✅ Lap time submitted! Server is calculating...`;
        
        // Wait for Cloud Function to process
        setTimeout(() => {
            messageDiv.textContent = `✅ Lap time processed successfully!`;
            document.getElementById('lapTimeForm').reset();
            
            // Refresh displays
            loadLeaderboard();
            loadRoundData();
        }, 3000);
        
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 5000);
        
    } catch (error) {
        console.error('Error:', error);
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.textContent = '❌ ' + error.message;
    }
});

// Load tracks and cars
async function loadTracksAndCars() {
    const tracksRef = window.firebaseRef(window.firebaseDB, 'Tracks');
    const carsRef = window.firebaseRef(window.firebaseDB, 'Cars');
    
    try {
        const [tracksSnapshot, carsSnapshot] = await Promise.all([
            window.firebaseGet(tracksRef),
            window.firebaseGet(carsRef)
        ]);
        
        const tracksData = tracksSnapshot.val() || [];
        const carsData = carsSnapshot.val() || [];
        
        // Collect and sort tracks alphabetically
        const tracks = [];
        tracksData.forEach(row => {
            const trackCombo = row['Track_Combos'];
            if (trackCombo && trackCombo.trim()) {
                tracks.push(trackCombo.trim());
            }
        });
        tracks.sort((a, b) => a.localeCompare(b));
        
        const trackSelect = document.getElementById('trackLayout');
        trackSelect.innerHTML = '<option value="">-- Select Track & Layout --</option>';
        
        tracks.forEach(track => {
            const option = document.createElement('option');
            option.value = track;
            option.textContent = track;
            trackSelect.appendChild(option);
        });
        
        // Collect and sort cars alphabetically
        const cars = [];
        carsData.forEach(row => {
            const carName = row['Car_Name'];
            if (carName && carName.trim()) {
                cars.push(carName.trim());
            }
        });
        cars.sort((a, b) => a.localeCompare(b));
        
        const carSelect = document.getElementById('carName');
        carSelect.innerHTML = '<option value="">-- Select Car --</option>';
        
        cars.forEach(car => {
            const option = document.createElement('option');
            option.value = car;
            option.textContent = car;
            carSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading tracks and cars:', error);
    }
}

// Round Setup submission
document.getElementById('roundSetupForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const roundNumber = parseInt(document.getElementById('roundNumber').value);
    const trackLayout = document.getElementById('trackLayout').value;
    const carName = document.getElementById('carName').value;
    const season = parseInt(document.getElementById('season').value);
    
    const messageDiv = document.getElementById('setupMessage');
    
    messageDiv.style.display = 'block';
    messageDiv.style.background = '#d1ecf1';
    messageDiv.style.color = '#0c5460';
    messageDiv.textContent = '⏳ Saving round configuration...';
    
    try {
        const setupData = {
            Timestamp: new Date().toISOString(),
            Round_Number: roundNumber,
            'Track-Layout': trackLayout,
            Car_Name: carName,
            Season: season
        };
        
        const setupRef = window.firebaseRef(window.firebaseDB, 'Form_responses_2');
        await window.firebasePush(setupRef, setupData);
        
        messageDiv.style.background = '#d4edda';
        messageDiv.style.color = '#155724';
        messageDiv.textContent = '✅ Round configuration saved!';
        
        document.getElementById('roundSetupForm').reset();
        
        setTimeout(() => {
            messageDiv.style.display = 'none';
            loadRoundSetup();
        }, 2000);
        
    } catch (error) {
        console.error('Error saving round setup:', error);
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.textContent = '❌ Error: ' + error.message;
    }
});

// Load Round Setup
async function loadRoundSetup() {
    const setupRef = window.firebaseRef(window.firebaseDB, 'Form_responses_2');
    const roundDataRef = window.firebaseRef(window.firebaseDB, 'Round_Data');
    const tracksRef = window.firebaseRef(window.firebaseDB, 'Tracks');
    const carsRef = window.firebaseRef(window.firebaseDB, 'Cars');
    
    try {
        const [setupSnapshot, roundDataSnapshot, tracksSnapshot, carsSnapshot] = await Promise.all([
            window.firebaseGet(setupRef),
            window.firebaseGet(roundDataRef),
            window.firebaseGet(tracksRef),
            window.firebaseGet(carsRef)
        ]);
        
        // Convert to array if it's an object
        let setupDataRaw = setupSnapshot.val();
        let setupDataArray = [];
        if (setupDataRaw) {
            if (Array.isArray(setupDataRaw)) {
                setupDataArray = setupDataRaw;
            } else {
                setupDataArray = Object.values(setupDataRaw);
            }
        }
        
        const setupData = setupDataArray
            .filter(row => row && row['Round_Number'])
            .map(row => ({
                timestamp: new Date(row.Timestamp),
                round: row['Round_Number'],
                trackLayout: row['Track-Layout'],
                car: row['Car_Name'],
                season: row.Season
            }));
        
        // Populate season dropdown
        const seasons = [...new Set(setupData.map(s => s.season))].filter(s => s).sort((a, b) => a - b);
        const setupSeasonSelect = document.getElementById('setupSeasonSelect');
        const currentSeasonValue = setupSeasonSelect.value;
        
        setupSeasonSelect.innerHTML = '<option value="">All Seasons</option>';
        seasons.forEach(season => {
            const option = document.createElement('option');
            option.value = season;
            option.textContent = `Season ${season}`;
            setupSeasonSelect.appendChild(option);
        });
        setupSeasonSelect.value = currentSeasonValue;
        
        // Filter by selected season
        const selectedSeason = setupSeasonSelect.value;
        let filteredSetupData = setupData;
        if (selectedSeason) {
            filteredSetupData = setupData.filter(s => s.season == selectedSeason);
        }
        
        // Use combination of round + season as unique key
        const uniqueRounds = {};

        // Sort setupData by season and round
        setupData.sort((a, b) => {
            if (a.season !== b.season) return a.season - b.season;
            return a.round - b.round;
        });
        filteredSetupData.forEach(setup => {
            const key = `${setup.season}-${setup.round}`;
            if (!uniqueRounds[key] || setup.timestamp > uniqueRounds[key].timestamp) {
                uniqueRounds[key] = setup;
            }
        });
        
        const finalSetupData = Object.values(uniqueRounds);
        
        // Convert roundData to array if it's an object
        let roundDataRaw = roundDataSnapshot.val();
        let roundDataArray = [];
        if (roundDataRaw) {
            if (Array.isArray(roundDataRaw)) {
                roundDataArray = roundDataRaw;
            } else {
                roundDataArray = Object.values(roundDataRaw);
            }
        }
        
        const roundData = roundDataArray
            .filter(row => row && row.Round && row['Total_Lap_Time'])
            .map(row => ({
                round: row.Round,
                driver: row.Driver,
                sector1: parseFloat(row['Sector_1']) || 0,
                sector2: parseFloat(row['Sector_2']) || 0,
                sector3: parseFloat(row['Sector_3']) || 0,
                totalTime: parseFloat(row['Total_Lap_Time']) || 0,
                trackLayout: row['Track-Layout'],
                car: row['Car_Name'],
                season: row.Season
            }));
        
        // Convert tracksData to array if it's an object
        let tracksDataRaw = tracksSnapshot.val();
        let tracksDataArray = [];
        if (tracksDataRaw) {
            if (Array.isArray(tracksDataRaw)) {
                tracksDataArray = tracksDataRaw;
            } else {
                tracksDataArray = Object.values(tracksDataRaw);
            }
        }
        
        const tracksMap = {};
        tracksDataArray.forEach(row => {
            if (row) {
                const trackCombo = row['Track_Combos'];
                const trackImage = row['Track_Image_URL'];
                if (trackCombo) {
                    tracksMap[trackCombo.trim()] = trackImage || 'https://via.placeholder.com/150x100?text=No+Image';
                }
            }
        });
        
        // Convert carsData to array if it's an object
        let carsDataRaw = carsSnapshot.val();
        let carsDataArray = [];
        if (carsDataRaw) {
            if (Array.isArray(carsDataRaw)) {
                carsDataArray = carsDataRaw;
            } else {
                carsDataArray = Object.values(carsDataRaw);
            }
        }
        
        const carsMap = {};
        carsDataArray.forEach(row => {
            if (row) {
                const carName = row['Car_Name'];
                const carImage = row['Car_Image_URL'];
                if (carName) {
                    carsMap[carName.trim()] = carImage || 'https://via.placeholder.com/150x100?text=No+Image';
                }
            }
        });
        
        displayRoundCards(finalSetupData, roundData, tracksMap, carsMap);
        
        document.getElementById('setup-cards-loading').style.display = 'none';
        document.getElementById('setup-cards-content').style.display = 'block';
        
    } catch (error) {
        console.error('Error loading round setup:', error);
        document.getElementById('setup-cards-loading').innerHTML = `
            <div style="background: #f8d7da; padding: 20px; border-radius: 10px; color: #721c24;">
                <strong>⚠️ Error loading round setup</strong>
                <p>${error.message}</p>
            </div>
        `;
    }
}

function displayRoundCards(setupData, roundData, tracksMap, carsMap) {
    const container = document.getElementById('round-cards-grid');
    container.innerHTML = '';

    const fallbackTrackImage = 'https://static.vecteezy.com/system/resources/previews/015/114/628/non_2x/race-track-icon-isometric-road-circuit-vector.jpg';
    const fallbackCarImage = 'https://thumb.silhouette-ac.com/t/e9/e9f1eb16ae292f36be10def00d95ecbb_t.jpeg';
    
    if (setupData.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 40px; color: #666;">No rounds configured yet. Use the form below to add your first round!</p>';
    } else {
        // Sort setupData by season and round
        setupData.sort((a, b) => {
            if (a.season !== b.season) return a.season - b.season;
            return a.round - b.round;
        });
        
        setupData.forEach(setup => {
            // Filter round times by BOTH round number AND season
            const roundTimes = roundData.filter(rd => 
                rd.round === setup.round && rd.season === setup.season
            );
            
            const comboTimes = roundData.filter(rd => 
                rd.trackLayout === setup.trackLayout && rd.car === setup.car
            );
            
            const bestRoundTime = roundTimes.length > 0 
                ? roundTimes.reduce((best, current) => current.totalTime < best.totalTime ? current : best)
                : null;
            
            const bestComboTime = comboTimes.length > 0
                ? comboTimes.reduce((best, current) => current.totalTime < best.totalTime ? current : best)
                : null;
            
            const bestSector1 = comboTimes.length > 0
                ? comboTimes.reduce((best, current) => current.sector1 < best.sector1 ? current : best)
                : null;
            
            const bestSector2 = comboTimes.length > 0
                ? comboTimes.reduce((best, current) => current.sector2 < best.sector2 ? current : best)
                : null;
            
            const bestSector3 = comboTimes.length > 0
                ? comboTimes.reduce((best, current) => current.sector3 < best.sector3 ? current : best)
                : null;
            
            const card = document.createElement('div');
            card.className = 'round-card';
            
            const trackImage = tracksMap[setup.trackLayout] || fallbackTrackImage;
            const carImage = carsMap[setup.car] || fallbackCarImage;
            
            card.innerHTML = `
                <div class="round-card-header">
                    <h3>Round ${setup.round}</h3>
                    <p class="season-number" style="margin: 5px 0 0 0; opacity: 0.9;">${setup.season}</p>
                </div>
                
                <div class="round-card-images">
                    <div class="round-card-image-container">
                        <img src="${trackImage}" alt="${setup.trackLayout}" onerror="this.src='${fallbackTrackImage}'">
                        <p>${setup.trackLayout}</p>
                    </div>
                    <div class="round-card-image-container">
                        <img src="${carImage}" alt="${setup.car}" onerror="this.src='${fallbackCarImage}'">
                        <p>${setup.car}</p>
                    </div>
                </div>
                
                <div class="round-card-body">
                    ${bestRoundTime ? `
                    <div class="best-time-section">
                        <h4>🏆 This Round's Best</h4>
                        <div class="best-time-item gold">
                            <div>
                                <div class="best-time-label">${getFormattedDriverName(bestRoundTime.driver)}</div>
                                <div class="best-time-context">Round ${setup.round} - Season ${setup.season}</div>
                            </div>
                            <div class="best-time-value">${formatTime(bestRoundTime.totalTime)}</div>
                        </div>
                    </div>
                    ` : '<div class="best-time-section"><p style="color: #999;">No lap times recorded yet</p></div>'}
                    
                    ${bestComboTime ? `
                    <div class="best-time-section">
                        <h4>⚡ All-Time Best (This Combo)</h4>
                        <div class="best-time-item">
                            <div>
                                <div class="best-time-label">Lap: ${getFormattedDriverName(bestComboTime.driver)}</div>
                                <div class="best-time-context">Round ${bestComboTime.round}${bestComboTime.season ? ` - Season ${bestComboTime.season}` : ''}</div>
                            </div>
                            <div class="best-time-value">${formatTime(bestComboTime.totalTime)}</div>
                        </div>
                        <div class="best-time-item">
                            <div>
                                <div class="best-time-label">S1: ${getFormattedDriverName(bestSector1.driver)}</div>
                                <div class="best-time-context">Round ${bestSector1.round}${bestSector1.season ? ` - Season ${bestSector1.season}` : ''}</div>
                            </div>
                            <div class="best-time-value">${formatTime(bestSector1.sector1)}</div>
                        </div>
                        <div class="best-time-item">
                            <div>
                                <div class="best-time-label">S2: ${getFormattedDriverName(bestSector2.driver)}</div>
                                <div class="best-time-context">Round ${bestSector2.round}${bestSector2.season ? ` - Season ${bestSector2.season}` : ''}</div>
                            </div>
                            <div class="best-time-value">${formatTime(bestSector2.sector2)}</div>
                        </div>
                        <div class="best-time-item">
                            <div>
                                <div class="best-time-label">S3: ${getFormattedDriverName(bestSector3.driver)}</div>
                                <div class="best-time-context">Round ${bestSector3.round}${bestSector3.season ? ` - Season ${bestSector3.season}` : ''}</div>
                            </div>
                            <div class="best-time-value">${formatTime(bestSector3.sector3)}</div>
                        </div>
                    </div>
                    ` : ''}
                </div>
            `;
            
            container.appendChild(card);
        });
    }
    
    document.getElementById('setup-cards-loading').style.display = 'none';
    document.getElementById('setup-cards-content').style.display = 'block';
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
        
        const roundData = roundSnapshot.val() || [];
        const leaderboardData = leaderboardSnapshot.val() || [];
        
        // Get unique drivers
        const drivers = [...new Set(leaderboardData.map(r => r.Driver))].filter(d => d);
        
        const driversContent = document.getElementById('drivers-content');
        driversContent.innerHTML = '';
        
        drivers.forEach(driverName => {
            const driverRoundData = roundData.filter(r => r.Driver === driverName);
            const driverLeaderboard = leaderboardData.find(l => l.Driver === driverName) || {};
            
            const totalPoints = parseInt(driverLeaderboard['Total_Points']) || 0;
            const totalPurpleSectors = parseInt(driverLeaderboard['Total_Purple_Sectors']) || 0;
            const totalWins = parseInt(driverLeaderboard['Total_Wins']) || 0;
            
            const totalRounds = driverRoundData.length;
            const avgPosition = totalRounds > 0 
                ? (driverRoundData.reduce((sum, r) => sum + (parseInt(r.Position) || 0), 0) / totalRounds).toFixed(1)
                : 'N/A';
            
            // Calculate Personal Best Lap
            let personalBest = null;
            if (driverRoundData.length > 0) {
                personalBest = driverRoundData.reduce((best, current) => {
                    const currentTime = parseFloat(current['Total_Lap_Time']) || Infinity;
                    const bestTime = best ? parseFloat(best['Total_Lap_Time']) || Infinity : Infinity;
                    return currentTime < bestTime ? current : best;
                }, null);
            }
            
            // Calculate Track + Car Records (unique combinations with best times)
            const trackCarRecords = {};
            driverRoundData.forEach(record => {
                const key = `${record['Track-Layout']} - ${record['Car_Name']}`;
                const time = parseFloat(record['Total_Lap_Time']) || Infinity;
                if (!trackCarRecords[key] || time < trackCarRecords[key].time) {
                    trackCarRecords[key] = {
                        combo: key,
                        time: time,
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
            const favoriteTrack = Object.keys(trackCounts).reduce((a, b) => 
                trackCounts[a] > trackCounts[b] ? a : b, Object.keys(trackCounts)[0] || 'N/A');
            
            // Calculate Favorite Car (most appearances)
            const carCounts = {};
            driverRoundData.forEach(r => {
                const car = r['Car_Name'];
                if (car) {
                    carCounts[car] = (carCounts[car] || 0) + 1;
                }
            });
            const favoriteCar = Object.keys(carCounts).reduce((a, b) => 
                carCounts[a] > carCounts[b] ? a : b, Object.keys(carCounts)[0] || 'N/A');
            
            // Calculate Head-to-Head Records
            const h2hRecords = {};
            const allDrivers = [...new Set(roundData.map(r => r.Driver))].filter(d => d && d !== driverName);
            
            allDrivers.forEach(opponent => {
                const sharedRounds = {};
                
                // Group by round
                roundData.forEach(r => {
                    if (!sharedRounds[r.Round]) {
                        sharedRounds[r.Round] = {};
                    }
                    if (r.Driver === driverName || r.Driver === opponent) {
                        sharedRounds[r.Round][r.Driver] = parseInt(r.Position) || 999;
                    }
                });
                
                // Count wins/losses
                let wins = 0;
                let losses = 0;
                Object.values(sharedRounds).forEach(round => {
                    if (round[driverName] && round[opponent]) {
                        if (round[driverName] < round[opponent]) wins++;
                        else if (round[driverName] > round[opponent]) losses++;
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
                    const email = ALLOWED_USERS[loginName].email;
                    if (DRIVER_PROFILES[email]) {
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
            
            const championshipPosition = leaderboardData.findIndex(l => l.Driver === driverName) + 1 || 'N/A';
            
            const card = document.createElement('div');
            card.className = 'driver-card';
            card.setAttribute('data-driver', driverName);
            
            // Desktop photo HTML
            let desktopPhotoHtml = '';
            if (profile && profile.photoUrl) {
                let photoUrl = profile.photoUrl;
                if (photoUrl.includes('drive.google.com/uc?id=')) {
                    const fileId = photoUrl.split('id=')[1];
                    photoUrl = `https://lh3.googleusercontent.com/d/${fileId}=s200`;
                }
                desktopPhotoHtml = `
                    <div class="driver-photo-container">
                        <img src="${photoUrl}" alt="${formattedName}" class="driver-photo">
                        <div class="driver-number-badge">${profile.number || '?'}</div>
                    </div>
                `;
            }
            
            // Mobile photo HTML
            let mobilePhotoHtml = '';
            if (profile && profile.photoUrl) {
                let photoUrl = profile.photoUrl;
                if (photoUrl.includes('drive.google.com/uc?id=')) {
                    const fileId = photoUrl.split('id=')[1];
                    photoUrl = `https://lh3.googleusercontent.com/d/${fileId}=s200`;
                }
                mobilePhotoHtml = `
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
                <!-- DESKTOP HEADER -->
                <div class="driver-header">
                    ${desktopPhotoHtml}
                    <div class="driver-info">
                        <h2>${formattedName}</h2>
                        <div class="driver-position">Championship Position: ${championshipPosition}</div>
                    </div>
                </div>
                
                <!-- MOBILE HEADER -->
                <div class="driver-header-mobile">
                    ${mobilePhotoHtml}
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
                                    ${personalBest['Track-Layout']}<br>
                                    ${personalBest['Car_Name']}
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
        
        document.getElementById('drivers-loading').style.display = 'none';
        document.getElementById('drivers-content').style.display = 'block';
        
    } catch (error) {
        console.error('Error loading driver stats:', error);
        document.getElementById('drivers-loading').innerHTML = '<p style="color: red;">Error loading driver statistics</p>';
    }
}

// Load Profile
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
    
    // Load existing profile data
    const profile = DRIVER_PROFILES[currentUser.email] || {};
    
    document.getElementById('profileName').value = profile.name || '';
    document.getElementById('profileSurname').value = profile.surname || '';
    document.getElementById('profileNumber').value = profile.number || '';
    document.getElementById('profilePhotoUrl').value = profile.photoUrl || '';
    document.getElementById('profileBio').value = profile.bio || '';
    
    // Show photo preview if exists
    if (profile.photoUrl) {
        let photoUrl = profile.photoUrl;
        if (photoUrl.includes('drive.google.com/uc?id=')) {
            const fileId = photoUrl.split('id=')[1];
            photoUrl = `https://lh3.googleusercontent.com/d/${fileId}=s200`;
        }
        document.getElementById('photoPreviewImg').src = photoUrl;
        document.getElementById('photoPreview').style.display = 'block';
    }
}

// Profile form submission
document.getElementById('profileForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (!currentUser) {
        alert('Please sign in to update your profile');
        return;
    }
    
    const messageDiv = document.getElementById('profileMessage');
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
        const profilesData = profilesSnapshot.val() || [];
        
        const existingIndex = profilesData.findIndex(p => p.Email === currentUser.email);
        
        if (existingIndex >= 0) {
            // Update existing profile
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
            number: profileData.Number.toString(),
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
                let photoUrl = profile.photoUrl;
                if (photoUrl.includes('drive.google.com/uc?id=')) {
                    const fileId = photoUrl.split('id=')[1];
                    photoUrl = `https://lh3.googleusercontent.com/d/${fileId}=s200`;
                }
                photoElement.src = photoUrl;
                numberBadge.textContent = profile.number || '?';
                photoContainer.style.display = 'block';
                iconFallback.style.display = 'none';
            }
        }, 2000);
        
    } catch (error) {
        console.error('Error saving profile:', error);
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.textContent = '❌ Error: ' + error.message;
    }
});

// Photo file input handler
document.getElementById('photoFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('photoPreviewImg').src = e.target.result;
        document.getElementById('photoPreview').style.display = 'block';
        
        alert('⚠️ Photo upload to storage not yet implemented. Please upload to Google Drive and paste the sharing link in the Photo URL field.');
    };
    reader.readAsDataURL(file);
});

// Event listeners
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

// Hide Submit and Setup tabs on page load if not logged in
document.addEventListener('DOMContentLoaded', function() {
    if (!currentUser) {
        const submitTab = document.querySelector('.tab-button[onclick*="submit"]');
        const setupTab = document.querySelector('.tab-button[onclick*="setup"]');
        if (submitTab) submitTab.style.display = 'none';
        if (setupTab) setupTab.style.display = 'none';
    }
});
