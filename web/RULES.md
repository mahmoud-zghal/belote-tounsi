# Belote Tounsi — Rules Spec (Server Authority)

This document defines the gameplay logic currently enforced by the multiplayer server.

## 1) Teams and seats
- 4 seats: 0,1,2,3
- Teams are by parity:
  - Team A: seats 0 and 2
  - Team B: seats 1 and 3

## 2) Bidding
- Start phase: `bidding`
- Starting bidder: seat 0
- Valid bids:
  - value: 90..160 step 10
  - suit: one of ♠ ♥ ♦ ♣
- Bid must be strictly higher than current highest (+10 minimum).
- `pass` is always allowed on your turn.

### Kabbout
- `kabbout` sets contract to 500 with selected suit.
- Kabbout immediately starts play phase.
- Kabbout is not followed by contree/surcontree phase.

### End of bidding
- If everyone passes with no bid: redeal and rotate first bidder by +1.
- If there is a highest bid and 3 passes follow it:
  - contract is fixed
  - trump = contract suit
  - if not kabbout: go to coinche phase

## 3) Coinche phase
- Stage order:
  1. `contree` stage — defenders only, in order
  2. if any defender says contree, go to `surcontree` stage — takers only, in order
- Multipliers:
  - default: x1
  - contree: x2
  - surcontree: x4
- If no contree chosen after defenders pass, go to play with x1.
- If surcontree not chosen after takers pass, go to play with x2.

## 4) Play phase legality
- Must follow lead suit if possible.
- If lead suit is trump: must rise (overtrump) when possible.
- Otherwise follow-suit only is enforced in this MVP.

## 5) Connectivity and timeout behavior
- Reconnect grace window is configurable (default 45s).
- If current-turn player remains disconnected past grace timeout:
  - bidding: auto-pass
  - coinche: auto-pass
  - play: server auto-plays first legal card

## 6) Source of truth
- Server is authoritative for legal actions, turn progression, and phase transitions.
- Client UI is advisory and may be stale; server validation always wins.
