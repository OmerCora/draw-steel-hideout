# Draw Steel - Hideout

[![Downloads](https://img.shields.io/github/downloads/OmerCora/draw-steel-hideout/total?label=Downloads&color=4aa94a)](https://github.com/OmerCora/draw-steel-hideout/releases)
[![Latest Version Downloads](https://img.shields.io/github/downloads/OmerCora/draw-steel-hideout/latest/total?label=Latest%20Version&color=4aa94a)](https://github.com/OmerCora/draw-steel-hideout/releases/latest)
[![Foundry Installs](https://img.shields.io/endpoint?url=https://foundryshields.com/installs?packageName=draw-steel-hideout)](https://foundryvtt.com/packages/draw-steel-hideout)

A Foundry VTT module for the [Draw Steel](https://mcdmproductions.com) system. Tracks respite projects, manages followers, keeps the party stash organised, and lets you archive crafting recipes.

## Summary

This module gives the Director and the party a single window for everything that happens during a respite. Assign heroes and followers to projects, configure edges and banes per actor, roll all project rolls at once, and let the module handle breakthrough chaining automatically. Between sessions use the stash to track party loot and the archive to save crafting blueprints you want to come back to.

## Features

### Project Board

- **Create, edit, and delete projects** with a name, optional goal, project type, roll characteristic, and optional source item link
- **Drag heroes and followers** from the roster onto a project to assign them as contributors
- **Yield items** link a compendium item as the project reward; when the project completes a button appears to add it to the party stash
- **Restart completed projects** to reset progress and reuse the same setup
- **Filter and sort** by name, progress, or contributor count
- **Project Events** are automated and can be configured based on rules described in Draw Steel: Heroes

<img width="1184" height="783" alt="Screenshot 2026-04-25 234248" src="https://github.com/user-attachments/assets/65e260fa-ac63-4617-8bea-6cea0b7b73b1" />


### Followers (Artisan & Sage)
- A new type of actor: Follower
- Roster panel lists all heroes and followers in the party
- Hover a follower to see their speciality and mentor
- A quick follower creation interface following the rules for Artisan and Sage
- Drag followers onto projects just like heroes; they contribute their own project roll with the correct characteristic automatically

<img width="524" height="256" alt="Screenshot 2026-04-25 235201" src="https://github.com/user-attachments/assets/bfc787ff-9d75-408e-95d0-7d26a8f80712" />

<img width="530" height="735" alt="Screenshot 2026-04-26 001539" src="https://github.com/user-attachments/assets/c6d7bd7d-849c-4d6d-a6ac-ccc1e86a9112" />

### Roll All 

Opens a table with every contributor, their characteristic value, and edge/bane dropdowns. Click Roll All and the module:

- Evaluates every project roll simultaneously (Dice So Nice supported)
- Posts a chat message with each actor, their roll broken down as dice total + modifier and the points earned
- Automatically handles **Breakthrough**: any natural roll of 19-20 triggers another roll for that actor, posted as its own "Breakthrough Roll!" chat message. The ⚡ icon in the chat table shows who triggered each one.

<img width="601" height="525" alt="Screenshot 2026-04-26 002913" src="https://github.com/user-attachments/assets/ee3b2527-fabd-42b7-9430-b44d836c8253" />


### Party Stash

- Add items from the Treasure Browser into the stash
- Items group by category with echelon labels

<img width="1181" height="782" alt="Screenshot 2026-04-25 234301" src="https://github.com/user-attachments/assets/2dbca810-5ea8-40a9-bee6-568c445cffce" />


### Archives

- Save crafting recipes and blueprints discovered during the campaign
- Add items from the Treasure Browser with the **Add to Archives** button
- Items are listed by category with expandable descriptions and project data
- Archive entries with crafting data get a **Begin Crafting Project** button that opens the project directly on the Project Board
- Track project sources (crafting materials)

<img width="1234" height="818" alt="Screenshot 2026-04-26 004141" src="https://github.com/user-attachments/assets/3cdd47d1-96b9-43ef-9700-de581b8b5824" />


### Treasure Browser

- Browse all items in the Draw Steel compendium or current World, supports third party treasure compendiums
- Filter by name and echelon (1-4)
- Add to Stash, Add to Archives, or Begin Crafting Project directly from the browser

<img width="725" height="789" alt="Screenshot 2026-04-25 232949" src="https://github.com/user-attachments/assets/9d49e664-69ab-494e-929c-79ea525a8652" />


## Project Browser

<img width="763" height="853" alt="Screenshot 2026-04-25 232914" src="https://github.com/user-attachments/assets/8d27ee13-1557-4ea7-a804-3d78386d950c" />

## Chat Messages

<img width="289" height="357" alt="Screenshot 2026-04-26 005129" src="https://github.com/user-attachments/assets/dc176251-2742-4993-bf86-a285bcc0af6e" />
<img width="288" height="451" alt="Screenshot 2026-04-26 005112" src="https://github.com/user-attachments/assets/7c8f7967-b561-416e-bf3c-84fa902d4624" />
<img width="294" height="89" alt="Screenshot 2026-04-26 004957" src="https://github.com/user-attachments/assets/79b4fc41-5945-402d-8f1e-d46c73349771" />


## Installation

Search for **"Draw Steel - Hideout"** in the Foundry module browser, or paste the manifest URL directly:

```
https://github.com/OmerCora/draw-steel-hideout/releases/latest/download/module.json
```

## Compatibility

| | Version |
|---|---|
| **Foundry VTT** | v13+ (verified 14.360) |
| **Draw Steel System** | v0.9.0+ (verified 1.0.0) |

## License

Module code is licensed under [MIT](LICENSE).

This module uses content from *Draw Steel: Heroes* (ISBN: 978-1-7375124-7-9) under the [DRAW STEEL Creator License](https://mcdm.gg/DS-license).

## Support

If you find this module useful, consider supporting development:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/G2G263V03)

---

*Draw Steel - Hideout is an independent product published under the DRAW STEEL Creator License and is not affiliated with MCDM Productions, LLC. DRAW STEEL &copy; 2024 MCDM Productions, LLC.*
