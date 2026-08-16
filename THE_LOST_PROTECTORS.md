# The Lost Explorers Directive


### Overview

The purpose of this is to create the simulation for The Lost Explorers on heroic difficulty. This is the last boss we need to create a similation for.

There are 3 bosses: 
- First Mate Nama
- Trader Gebbo
- ScrollSage Iku

There is one untargetable boss Mor'zahi - he will be represented as an energy bar. 

When Mor'zahi reaches 100 energy its a wipe. The simulation will show this bar as the boss's energy. 

When all 3 bosses are within 30 yards of each other they take 99% less damage. Only 2 of the bosses are tankable, First Mate Nama and ScrollSage Iku. Trader Gebbo just walks round in a circle on his own.

No boss is static. 

Bosses need to die to the same time as the bosses who dont die gain new abilities as one of them dies. The simulation should show a warning when 1 boss is less than 10% health and the other bosses have a greater than 10% health difference to the lowest health boss. 

There are 3 fishes in the whole encounter. Only 1 fish can be found every Throw Junk. 

Each boss can only become empowered once and remain empowered until dead. 

After 3 fishes are used, the bosses need to die before the energy bar reaches 100% at which point the raid wipes due to enrage. When a boss is fed a fish, the energy bar resets to 0. 

### Encounter room. 

The boss room is a circle shape, moving off the edge kills the player. 

### First Mate Nama

- Shell Spin: Nama throws three spinning shells in a frontal cone that stun on contact for 4 seconds. These need to be avoided
- Steady Strikes: Nama's tank mechanic requiring a tank swap when stacks get too high, the stacks are on melee hits so it will just slowly go up as the tank is tanking. 
- Mighty Thud: Only happens when First Mate Nama is empowered. Targets 3 none tank players and jumps to them starting with the closest, then the next closest then the last player. Damage is split to all players inside the soak. The player needs to go into one of these soaks, or the bot ai need to runs into the players soak to split the damage. 
- Relentless Escalation: Gets this when Trader Gebbo or ScrollSage Iku dies. The boss starts killing his tank and all the ai bots as he walks up to them and is very dangerous. 



### ScrollSage Iku

- Blink Nova: Targets a non tank player, after 4 seconds Iku blinks ontop of that player doing raid damage, the further the targeted player the less damage to the raid. 
- Icebound Flames: Targets random players for heavy damage. Must be interrupted. 
- Shredding Shards: Iku's tank mechanic - channel on the current tank, this requires a tank swap after each channel. 
- Frostfire Volley: Only happens when ScrollSage Iku is empowered. This hits some none tank players with burning flames and other none tank players with piercing frost. For the purpose of the simulation, if the player, when playing either the dps or healer role, will be randomly given burning flames or piercing frost, an ai bot none tank player will be given the opposite debuff. When the player and the bot is hit with Frostfire Volley, they will leave either a fire pool (if its burning flames) or ice pool (if its piercing frost). The player and the bot then have a debuff that only gets removed when they run into the opposite pool, so if the player has burning flames, they need to run into the ice pool to remove the debuff and vice versa. The bot will do the same. If Frostfire Volley happens again before the player has removed this debuff it kills the player.
- Cataclysmic Invocation: Gains this ability when First Mate Nama or Trader Gebbo dies. The boss every 3 seconds starts pulsing raid aoe damage that hits harder and harder until the raid wipes. 

### Trader Gebbo

- Throw Junk: Throws boxs around him as he walks round the arena in a circle. These need to be soaked by the player. The boxes revealed what they are hiding, and 1 will be a "Disgusting Fish". The player will pick this up and run it into one of the bosses for the simulation to feed them. This resets Mor'zahi energy back to 0 and **enpowers** the boss that was fed. All boxes must be picked up within 10 seconds otherwise the raid wipes. This essentially needs to be "Find the fish".
- Mushroom Toss: Only happens when Trader Gebbo is empowered, does this along with Explosive Surprise. Gebbo throws mushrooms around him, similar to the boxes. If the player comes into contact with this they get launched up into the air. 
- Explosive Surprise: Only happens when Trader Gebbo is empower, does this with Mushroom Toss. Targets the none tank player and after expires will place a bomb at that players location. A few seconds after the bomb is placed it explodes and sends a blast wave across the room from the bombs location. The only way to avoid this is by jumping on the mushrooms to jump over the blast wave. The bomb leaves a large pool on the ground that does damage to anyone standing in it. 
- Smashing shovel: Gets this when either First Mate Nama, or Scrollsage Iky dies. He starts knocking players back when they come in contact with him. He will knock them off the platform killing the player. 





