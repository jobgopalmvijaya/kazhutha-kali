# Installation Guide for Kazhutha Kali

## Prerequisites
- Node.js (v14 or higher)
- npm (comes with Node.js)

## Step-by-Step Installation

### 1. Install Backend Dependencies
```powershell
cd e:\CheetKali
npm install
```

### 2. Install Frontend Dependencies
```powershell
cd e:\CheetKali\client
npm install
```

### 3. Start the Application

#### Option A: Run Both Servers Simultaneously (Recommended)
From the root directory (e:\CheetKali):
```powershell
npm run dev
```

This will start:
- Backend server on http://localhost:5000
- Frontend server on http://localhost:3000

#### Option B: Run Servers Separately

Terminal 1 (Backend):
```powershell
cd e:\CheetKali
npm run server
```

Terminal 2 (Frontend):
```powershell
cd e:\CheetKali
npm run client
```

### 4. Access the Game
Open your browser and navigate to:
```
http://localhost:3000
```

## Quick Start Commands

```powershell
# Install all dependencies at once
npm run install-all

# Run development servers
npm run dev

# Build for production
npm run build
```

## Troubleshooting

### Port Already in Use
If port 5000 or 3000 is already in use, you can:
1. Stop the process using that port
2. Or modify the port in:
   - Backend: `server/server.js` (line with `const PORT`)
   - Frontend: `client/package.json` (add `"PORT=3001"` to start script)

### Module Not Found Errors
Run:
```powershell
npm run install-all
```

### Socket Connection Issues
Make sure:
1. Backend server is running on port 5000
2. No firewall blocking localhost connections
3. Check browser console for error messages

## Testing Multiplayer

### Quick Test (2-Player Game)
1. Open http://localhost:3000 in your browser
2. Enter your name and click "Create a room"
3. Copy the room ID or URL
4. Open http://localhost:3000 in another browser tab or incognito window
5. Enter a different name and the room ID, then join
6. As the host, click "Start Game"
7. Play the game following the Kazhutha Kali rules!

### Understanding the Game
- See [GAME_RULES.md](./GAME_RULES.md) for complete game rules and strategy
- Player with Ace of Spades (♠A) starts first
- Follow the lead suit if you have it
- Cut with a different suit to trigger "Pani" (punishment)
- Last player with cards loses!

### Testing Tips
- Use incognito windows for multiple players on same computer
- Test with 3-4 players for best experience
- Check browser console (F12) if you encounter issues
- Verify both servers are running before testing

## Production Deployment

For production deployment, you'll need to:
1. Update the Socket.io connection URL in client files to your production server
2. Build the React app: `npm run build`
3. Serve the built files with the backend server
4. Use a process manager like PM2 to keep the server running

Enjoy playing Kazhutha Kali! 🃏
