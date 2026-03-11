# Get local IP address candidates (excluding loopback and vEthernet/virtual)
$ips = Get-NetIPAddress -AddressFamily IPv4 -Type Unicast | Where-Object { 
    $_.InterfaceAlias -notlike "Loopback*" -and $_.InterfaceAlias -notlike "vEthernet*" -and $_.InterfaceAlias -notlike "*VMware*" -and $_.InterfaceAlias -notlike "*WSL*"
} | Select-Object InterfaceAlias, IPAddress

$lanIp = "localhost"

if ($ips) {
    # Prefer Ethernet or Wi-Fi
    $preferred = $ips | Where-Object { $_.InterfaceAlias -match "Ethernet|Wi-Fi" } | Select-Object -First 1
    if ($preferred) {
        $lanIp = $preferred.IPAddress
    }
    else {
        $lanIp = $ips[0].IPAddress
    }
}

Clear-Host
Write-Host ""
Write-Host "  Starting Docker containers..." -ForegroundColor Gray
Write-Host ""

# Start Docker Containers (detached, no logs spam)
docker-compose up -d --build 2>&1 | Out-Null

# Wait a moment for containers to start
Start-Sleep -Seconds 2

# Show the connection info AFTER docker starts
Clear-Host
Write-Host ""
Write-Host "  ======================================================" -ForegroundColor Cyan
Write-Host "              E-CARD: KAIJI ULTIMATE                    " -ForegroundColor Cyan
Write-Host "  ======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  [YOU]   Play here:       " -NoNewline
Write-Host "http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "  [LAN]   Share this link: " -NoNewline
Write-Host "http://$($lanIp):5173" -ForegroundColor Yellow
Write-Host ""
Write-Host "  ======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  NOTE: Ignore Docker's 'Network: 172.x.x.x' - that's" -ForegroundColor DarkGray
Write-Host "        Docker's internal IP. Use the LAN IP above." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Game is running! Both players use the same Room ID." -ForegroundColor Gray
Write-Host ""
Write-Host "  Commands:" -ForegroundColor Gray
Write-Host "    View logs:   docker-compose logs -f" -ForegroundColor DarkGray
Write-Host "    Stop game:   docker-compose down" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ======================================================" -ForegroundColor Cyan
Write-Host ""

# Keep terminal open with a prompt
Write-Host "  Press Enter to view logs, or Ctrl+C to exit..." -ForegroundColor Gray
Read-Host | Out-Null
docker-compose logs -f
