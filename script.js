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
