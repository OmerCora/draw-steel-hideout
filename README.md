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

### Followers (Artisan & Sage)
- A new type of actor: Follower
- Roster panel lists all heroes and followers in the party
- Hover a follower to see their speciality and mentor
- A quick follower creation interface following the rules for Artisan and Sage
- Drag followers onto projects just like heroes; they contribute their own project roll with the correct characteristic automatically

### Roll All 

Opens a table with every contributor, their characteristic value, and edge/bane dropdowns. Click Roll All and the module:

- Evaluates every project roll simultaneously (Dice So Nice supported)
- Posts a chat message with each actor, their roll broken down as dice total + modifier and the points earned
- Automatically handles **Breakthrough**: any natural roll of 19-20 triggers another roll for that actor, posted as its own "Breakthrough Roll!" chat message. The ⚡ icon in the chat table shows who triggered each one.

### Party Stash

- Add items from the Treasure Browser into the stash
- Items group by category with echelon labels

### Archive

- Save crafting recipes and blueprints discovered during the campaign
- Add items from the Treasure Browser with the **Add to Archives** button
- Items are listed by category with expandable descriptions and project data
- Archive entries with crafting data get a **Begin Crafting Project** button that opens the project directly on the Project Board

### Treasure Browser

- Browse all items in the Draw Steel compendium or current World, supports third party treasure compendiums
- Filter by name and echelon (1-4)
- Add to Stash, Add to Archives, or Begin Crafting Project directly from the browser

## Screenshots


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