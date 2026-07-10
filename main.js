// ===== MAIN =====

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    if (screenId === 'singleplayer-screen') {
        initSingleplayer();
    }
}

function showRules() {
    document.getElementById('rules-modal').style.display = 'flex';
}

function hideRules() {
    document.getElementById('rules-modal').style.display = 'none';
}

// Close modal on outside click
document.getElementById('rules-modal').addEventListener('click', function(e) {
    if (e.target === this) {
        hideRules();
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    showScreen('menu-screen');
});
