# Belote Tounsi (Multiplayer MVP)

Multiplayer-first Tunisian-style Coinchée Belote prototype.

## Included
- Real-time room flow: create/join/start/leave/rematch
- 4 human seats (teams 1&3 vs 2&4)
- Bidding from 90 to 160
- Contree (x2) and Surcontree (x4)
- Kabbout contract
- Trump/non-trump rules and trick play sync
- French card labels in UI: V (Valet), D (Dame), R (Roi)
- Player-name based scoreboard (seat names from lobby)
- Hand display grouped by suit with red/black visual separation

## Run
Start the backend and serve static files from this folder.

Example static server:

```bash
python3 -m http.server 8080
```

Then open:

`http://localhost:8080`

Backend server runs on port `8787`.
