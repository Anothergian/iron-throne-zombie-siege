/* Iron Throne: Zombie Siege — dependency-light Three.js arcade prototype */
(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18211f);
  scene.fog = new THREE.FogExp2(0x18211f, 0.021);
  const camera = new THREE.PerspectiveCamera(47, innerWidth / innerHeight, 0.1, 150);
  camera.position.set(0, 20, 14);

  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const aimPoint = new THREE.Vector3(0, 0, -10);
  const touchMove = new THREE.Vector2();
  const touchAim = new THREE.Vector2(0, -1);
  let touchAiming = false;
  let touchFiring = false;
  const keys = Object.create(null);
  const ARENA = 22;
  const UP = new THREE.Vector3(0, 1, 0);

  const state = {
    running: false, paused: true, gameOver: false, wave: 0, cash: 0, kills: 0,
    spawned: 0, waveTotal: 0, spawnTimer: 0, fireHeld: false, lastShot: 0,
    health: 100, maxHealth: 100, armor: 25, maxArmor: 25,
    speed: 6.2, damage: 20, fireRate: 0.24,
    upgrades: { weapon: 0, armor: 0, health: 0, speed: 0 }
  };

  const enemies = [], bullets = [], rocks = [], particles = [];
  const mats = {};
  function mat(name, color, rough = .7, metal = .05, emissive = 0x000000) {
    return mats[name] ||= new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: emissive ? .65 : 0 });
  }
  const M = {
    black: mat('black', 0x151818, .43, .42), dark: mat('dark', 0x272b2a, .68, .22), rubber: mat('rubber', 0x0d0f0f, .96, .01),
    aqua: mat('aqua', 0x4fcfc5, .34, .35), red: mat('red', 0xd9362f, .35, .25, 0x3b0503), gold: mat('gold', 0xd7a849, .3, .65),
    stone: mat('stone', 0x4a504b, .96), stone2: mat('stone2', 0x343936, 1), wood: mat('wood', 0x543b27, .9), iron: mat('iron', 0x323635, .48, .65)
  };

  function mesh(geo, material, parent, pos = [0, 0, 0], rot = [0, 0, 0], shadows = true) {
    pos ||= [0, 0, 0]; rot ||= [0, 0, 0];
    const o = new THREE.Mesh(geo, material); o.position.set(...pos); o.rotation.set(...rot);
    if (shadows) { o.castShadow = true; o.receiveShadow = true; }
    parent.add(o); return o;
  }
  function box(s, material, parent, p, r, radius = .08) {
    const g = radius ? new THREE.BoxGeometry(s[0], s[1], s[2], 2, 2, 2) : new THREE.BoxGeometry(...s);
    return mesh(g, material, parent, p, r);
  }
  function cyl(radius, depth, material, parent, p, r = [0, 0, 0], segments = 16) {
    return mesh(new THREE.CylinderGeometry(radius, radius, depth, segments), material, parent, p, r);
  }
  function tubeBetween(a, b, radius, material, parent) {
    const mid = a.clone().add(b).multiplyScalar(.5), len = a.distanceTo(b);
    const o = cyl(radius, len, material, parent, [mid.x, mid.y, mid.z]);
    o.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize()); return o;
  }

  function addWheel(parent, x, y, z, radius, width, omni = false) {
    const group = new THREE.Group(); group.position.set(x, y, z); parent.add(group);
    if (!omni) {
      cyl(radius, width, M.rubber, group, [0, 0, 0], [Math.PI / 2, 0, 0], 24);
      cyl(radius * .71, width + .025, M.dark, group, [0, 0, 0], [Math.PI / 2, 0, 0], 12);
      cyl(radius * .17, width + .05, M.iron, group, [0, 0, 0], [Math.PI / 2, 0, 0], 16);
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        box([.08, width + .06, radius * .43], M.black, group, [Math.sin(a) * radius * .43, 0, Math.cos(a) * radius * .43], [0, a, Math.PI / 2]);
      }
    } else {
      cyl(radius * .56, width * .7, M.dark, group, [0, 0, 0], [Math.PI / 2, 0, 0], 16);
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        const roller = cyl(radius * .115, radius * .56, M.rubber, group, [Math.sin(a) * radius * .84, 0, Math.cos(a) * radius * .84], [0, 0, a], 10);
        roller.rotation.z = -a; roller.rotation.x = Math.PI / 2;
      }
      cyl(radius * .19, width + .05, M.black, group, [0, 0, 0], [Math.PI / 2, 0, 0], 12);
    }
    return group;
  }

  function createWheelchair() {
    const root = new THREE.Group(); root.name = 'Combat wheelchair';
    const chassis = new THREE.Group(); chassis.position.y = .2; root.add(chassis);
    box([2.6, .32, 3.15], M.black, chassis, [0, 1.0, .1]);
    // turquoise side spars from the reference chair
    [-1, 1].forEach(x => {
      const a = new THREE.Vector3(x * 1.18, .82, -1.45), b = new THREE.Vector3(x * 1.18, 1.55, .45);
      tubeBetween(a, b, .17, M.aqua, chassis);
      tubeBetween(new THREE.Vector3(x * 1.18, 1.55, .45), new THREE.Vector3(x * 1.18, 1.55, 1.25), .17, M.aqua, chassis);
      // red front suspension
      tubeBetween(new THREE.Vector3(x * 1.28, .72, -1.45), new THREE.Vector3(x * 1.18, 1.25, -1.16), .07, M.red, chassis);
    });
    // rear drive wheels and omni wheels
    addWheel(chassis, -1.48, .86, 1.05, .92, .34, false); addWheel(chassis, 1.48, .86, 1.05, .92, .34, false);
    addWheel(chassis, -1.34, .62, -1.52, .62, .29, true); addWheel(chassis, 1.34, .62, -1.52, .62, .29, true);
    // foot plate
    box([1.75, .12, 1.05], M.dark, chassis, [0, .55, -1.95], [0, 0, 0]);
    // seat + high contoured backrest
    box([2.18, .36, 1.72], M.black, chassis, [0, 1.62, .3], [-.05, 0, 0]);
    const back = box([2.28, 2.35, .35], M.black, chassis, [0, 2.72, 1.02], [-.17, 0, 0]);
    box([1.92, 1.65, .25], M.dark, back, [0, .04, -.27]);
    box([2.35, .22, .38], M.black, chassis, [0, 3.86, .63], [-.17, 0, 0]);
    // arm rests + joystick
    [-1, 1].forEach((x, idx) => {
      tubeBetween(new THREE.Vector3(x * 1.2, 1.72, .7), new THREE.Vector3(x * 1.32, 2.62, .25), .11, M.black, chassis);
      box([.36, .15, 1.15], M.black, chassis, [x * 1.32, 2.65, -.22]);
      if (idx === 1) { cyl(.09, .42, M.black, chassis, [x * 1.32, 2.91, -.48]); cyl(.16, .22, M.dark, chassis, [x * 1.32, 3.12, -.48]); }
    });
    // rear battery, lights, basket hint
    box([1.25, .77, .7], M.black, chassis, [0, 1.05, 1.64]);
    box([.19, .48, .08], M.red, chassis, [0, 1.08, 2.02]);
    // weapon mount and rune cannon aimed toward local -Z
    const turret = new THREE.Group(); turret.position.set(0, 2.0, -.52); chassis.add(turret); root.userData.turret = turret;
    cyl(.34, .23, M.iron, turret, [0, 0, 0], [0, 0, Math.PI / 2], 16);
    const gun = box([.36, .38, 2.1], M.iron, turret, [0, .16, -1.0]); root.userData.gun = gun;
    box([.48, .5, .55], M.gold, turret, [0, .16, -.42]);
    cyl(.12, .6, M.red, turret, [0, .16, -2.08], [Math.PI / 2, 0, 0], 12);
    // glowing rune rings
    for (let i = 0; i < 3; i++) {
      const ring = mesh(new THREE.TorusGeometry(.24, .035, 8, 16), M.gold, turret, [0, .16, -1.08 - i * .35], [Math.PI / 2, 0, 0]);
      ring.castShadow = false;
    }
    root.scale.setScalar(.86); return root;
  }

  function createCastle() {
    const world = new THREE.Group(); scene.add(world);
    const floor = mesh(new THREE.PlaneGeometry(70, 70, 36, 36), M.stone2, world, [0, -.04, 0], [-Math.PI / 2, 0, 0]);
    // courtyard slab grid
    const lineMat = new THREE.LineBasicMaterial({ color: 0x555a55, transparent: true, opacity: .22 });
    const pts = [];
    for (let i = -28; i <= 28; i += 2) { pts.push(new THREE.Vector3(i, .01, -28), new THREE.Vector3(i, .01, 28)); pts.push(new THREE.Vector3(-28, .01, i), new THREE.Vector3(28, .01, i)); }
    world.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    // walls and crenellations
    const wallParts = [[0, 2.3, -25, 50, 4.6, 1.5], [0, 2.3, 25, 50, 4.6, 1.5], [-25, 2.3, 0, 1.5, 4.6, 50], [25, 2.3, 0, 1.5, 4.6, 50]];
    wallParts.forEach(w => box([w[3], w[4], w[5]], M.stone, world, [w[0], w[1], w[2]], null, 0));
    for (let s = -1; s <= 1; s += 2) for (let i = -23; i <= 23; i += 3.2) {
      box([1.8, 1.2, 1.8], M.stone, world, [i, 5.1, s * 25]);
      box([1.8, 1.2, 1.8], M.stone, world, [s * 25, 5.1, i]);
    }
    // four corner towers
    [[-24,-24],[24,-24],[-24,24],[24,24]].forEach(([x,z]) => {
      cyl(3.2, 7, M.stone, world, [x, 3.5, z], [0,0,0], 12);
      for (let a = 0; a < 8; a++) { const q = a/8*Math.PI*2; box([1.25,1.25,1.3],M.stone,world,[x+Math.cos(q)*2.75,7.05,z+Math.sin(q)*2.75],[0,-q,0]); }
    });
    // central broken fountain and props
    cyl(2.5, .55, M.stone, world, [0, .25, 0], [0,0,0], 12); cyl(1.4, .9, M.stone2, world, [0,.55,0], [0,0,0], 12);
    const propSpots = [[-12,-8],[13,9],[-15,13],[10,-14],[-6,17],[17,-4]];
    propSpots.forEach(([x,z],i) => {
      if(i%2){box([1.2,1,1.2],M.wood,world,[x,.5,z]);box([1.25,.08,1.25],M.iron,world,[x,.8,z]);}
      else {cyl(.42,1.1,M.wood,world,[x,.55,z], [0,0,Math.PI/2],12);}
    });
    // torches
    const flameMat = mat('flame', 0xff982f, .2, 0, 0xff3c00);
    [[-20,-20],[20,-20],[-20,20],[20,20]].forEach(([x,z]) => {
      const light = new THREE.PointLight(0xff7d32, 13, 12, 2); light.position.set(x,3,z); world.add(light);
      mesh(new THREE.SphereGeometry(.18,8,8),flameMat,world,[x,2.8,z]);
    });
  }

  scene.add(new THREE.HemisphereLight(0xd8ebe6, 0x26342d, 2.15));
  const moon = new THREE.DirectionalLight(0xe7f4ef, 3.0); moon.position.set(-12, 24, 9); moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048); moon.shadow.camera.left = -30; moon.shadow.camera.right = 30; moon.shadow.camera.top = 30; moon.shadow.camera.bottom = -30; scene.add(moon);
  createCastle();
  const player = createWheelchair(); player.position.set(0, 0, 6); scene.add(player);

  const enemySpecs = {
    normal:  { hp: 55, speed: 2.0, damage: 9, reward: 16, scale: 1, color: 0x72855b, name: 'SCHLURFER' },
    runner:  { hp: 32, speed: 3.8, damage: 5, reward: 13, scale: .7, color: 0xb59a3d, name: 'FLITZER' },
    giant:   { hp: 220, speed: 1.15, damage: 8, reward: 44, scale: 1.75, color: 0x774239, name: 'RIESE' },
    thrower: { hp: 42, speed: 1.55, damage: 11, reward: 25, scale: .9, color: 0x685582, name: 'WERFER' }
  };
  function createZombie(type, wave) {
    const spec = enemySpecs[type], g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({color:spec.color,roughness:.88});
    const cloth = new THREE.MeshStandardMaterial({color:type==='giant'?0x312724:0x252a28,roughness:.95});
    cyl(.38, 1.15, cloth, g, [0, .95, 0], [0,0,0], 10);
    mesh(new THREE.SphereGeometry(.34,10,8),skin,g,[0,1.68,0]);
    // jaw/eyes make silhouettes readable from above
    const eyeMat = mat('eyes',0xffd85c,.3,0,0xff8a00);
    mesh(new THREE.SphereGeometry(.045,6,5),eyeMat,g,[-.12,1.75,-.29]); mesh(new THREE.SphereGeometry(.045,6,5),eyeMat,g,[.12,1.75,-.29]);
    [-1,1].forEach(s=>{tubeBetween(new THREE.Vector3(s*.31,1.28,0),new THREE.Vector3(s*.58,.65,-.05),.10,skin,g);tubeBetween(new THREE.Vector3(s*.19,.48,0),new THREE.Vector3(s*.31,.05,0),.13,cloth,g);});
    if(type==='giant'){box([1.1,.22,.65],M.iron,g,[0,1.2,.05]);}
    if(type==='thrower'){const rock=mesh(new THREE.DodecahedronGeometry(.25),M.stone2,g,[.55,1.05,-.1]);g.userData.heldRock=rock;}
    g.scale.setScalar(spec.scale); g.userData={...g.userData,type,spec,hp:spec.hp*(1+(wave-1)*.16),maxHp:spec.hp*(1+(wave-1)*.16),lastAttack:0,lastThrow:performance.now()/1000+Math.random()*2};
    const bar = new THREE.Group(); bar.position.set(0,2.22,0); bar.rotation.x=-Math.PI/2; g.add(bar); g.userData.bar=bar;
    const bg=mesh(new THREE.PlaneGeometry(.9,.09),new THREE.MeshBasicMaterial({color:0x190b09}),bar); const fg=mesh(new THREE.PlaneGeometry(.88,.055),new THREE.MeshBasicMaterial({color:0xd54a37}),bar,[0,0,.002]);g.userData.hpBar=fg;
    return g;
  }
  function chooseType() {
    const w=state.wave,r=Math.random();
    if(w>=4&&r<.12) return 'giant'; if(w>=3&&r<.29) return 'thrower'; if(w>=2&&r<.52) return 'runner'; return 'normal';
  }
  function spawnEnemy() {
    const side=Math.floor(Math.random()*4),p=(Math.random()*2-1)*19.5; let x,z;
    if(side===0){x=p;z=-21}else if(side===1){x=21;z=p}else if(side===2){x=p;z=21}else{x=-21;z=p}
    const e=createZombie(chooseType(),state.wave);e.position.set(x,0,z);scene.add(e);enemies.push(e);state.spawned++;updateHud();
  }

  function createBullet() {
    const now=performance.now()/1000;if(now-state.lastShot<state.fireRate||!state.running)return;state.lastShot=now;
    const dir=aimPoint.clone().sub(player.position);dir.y=0;dir.normalize();
    const p=mesh(new THREE.SphereGeometry(.12,7,7),M.gold,scene,[player.position.x+dir.x*1.7,1.55,player.position.z+dir.z*1.7]);
    p.castShadow=false;p.userData={velocity:dir.multiplyScalar(20),life:1.5,damage:state.damage};bullets.push(p);
    burst(p.position,0xffc65a,3,.8);
  }
  function throwRock(enemy) {
    const start=enemy.position.clone();start.y=1.2*enemy.userData.spec.scale;
    const rock=mesh(new THREE.DodecahedronGeometry(.22),M.stone2,scene,[start.x,start.y,start.z]);
    const target=player.position.clone();const time=1.25;const v=target.sub(start).divideScalar(time);v.y=5.2;
    rock.userData={velocity:v,life:time+1,damage:enemy.userData.spec.damage};rocks.push(rock);
  }
  function burst(position,color,count=8,speed=2) {
    const material=new THREE.MeshBasicMaterial({color});
    for(let i=0;i<count;i++){const p=mesh(new THREE.SphereGeometry(.045,4,4),material,scene,[position.x,position.y,position.z],null,false);p.userData={velocity:new THREE.Vector3((Math.random()-.5)*speed,Math.random()*speed,(Math.random()-.5)*speed),life:.35+Math.random()*.3};particles.push(p)}
  }
  function hurt(amount) {
    if(state.armor>0){const blocked=Math.min(state.armor,amount*.7);state.armor-=blocked;amount-=blocked}
    state.health-=amount;updateHud();
    document.body.animate([{filter:'none'},{filter:'sepia(.4) saturate(2) hue-rotate(315deg)'},{filter:'none'}],{duration:220});
    if(state.health<=0) endGame();
  }
  function killEnemy(e,index){state.cash+=e.userData.spec.reward;state.kills++;burst(e.position.clone().add(new THREE.Vector3(0,1,0)),e.userData.spec.color,12,3.2);scene.remove(e);enemies.splice(index,1);updateHud();}

  function startWave() {
    state.wave++;state.waveTotal=5+state.wave*3+Math.floor(state.wave*state.wave*.25);state.spawned=0;state.running=true;state.paused=false;state.spawnTimer=.5;
    document.querySelector('#shop').classList.add('hidden');announce(`WELLE ${state.wave}`,state.wave%5===0?'DIE HORDE KOMMT':'DIE TOTEN ERWACHEN');updateHud();
  }
  function finishWave(){state.running=false;state.paused=true;state.cash+=20+state.wave*5;state.armor=Math.min(state.maxArmor,state.armor+state.maxArmor*.25);updateHud();setTimeout(showShop,900)}
  function showShop(){document.querySelector('#shop').classList.remove('hidden');document.querySelector('#shopCash').textContent=Math.floor(state.cash);document.querySelector('#nextWaveHint').textContent=`Nächste Welle: ${state.wave+1}`;renderShop()}
  function endGame(){state.health=0;state.running=false;state.paused=true;state.gameOver=true;document.querySelector('#finalStats').textContent=`Du hast Welle ${state.wave} erreicht und ${state.kills} Zombies vernichtet.`;document.querySelector('#gameOver').classList.remove('hidden')}

  const upgradeDefs={
    weapon:{icon:'⌖',title:'WAFFE',desc:'+8 Schaden und schnelleres Feuern',base:75},
    armor:{icon:'⬟',title:'PANZERUNG',desc:'+20 Panzerung, sofort aufgefüllt',base:65},
    health:{icon:'✚',title:'LEBEN',desc:'+25 maximales Leben, sofort geheilt',base:70},
    speed:{icon:'➤',title:'ANTRIEB',desc:'+12 % Bewegungsgeschwindigkeit',base:60}
  };
  function upgradeCost(k){return Math.floor(upgradeDefs[k].base*Math.pow(1.55,state.upgrades[k]))}
  function buyUpgrade(k){const lvl=state.upgrades[k],cost=upgradeCost(k);if(lvl>=5||state.cash<cost)return;state.cash-=cost;state.upgrades[k]++;
    if(k==='weapon'){state.damage+=8;state.fireRate=Math.max(.11,state.fireRate-.022)}
    if(k==='armor'){state.maxArmor+=20;state.armor=state.maxArmor}
    if(k==='health'){state.maxHealth+=25;state.health=state.maxHealth}
    if(k==='speed'){state.speed*=1.12}
    updateHud();renderShop();toast(`${upgradeDefs[k].title} VERBESSERT`)}
  function renderShop(){const grid=document.querySelector('#upgradeGrid');grid.innerHTML='';Object.entries(upgradeDefs).forEach(([k,d])=>{const level=state.upgrades[k],cost=upgradeCost(k),el=document.createElement('article');el.className='upgrade'+(level>=5?' maxed':'');el.innerHTML=`<div class="upgrade-icon">${d.icon}</div><h3>${d.title}</h3><p>${d.desc}</p><div class="level-pips">${[0,1,2,3,4].map(i=>`<i class="${i<level?'on':''}"></i>`).join('')}</div><button ${level>=5||state.cash<cost?'disabled':''}>${level>=5?'MAXIMUM':`◆ ${cost} · KAUFEN`}</button>`;el.querySelector('button').onclick=()=>buyUpgrade(k);grid.appendChild(el)});document.querySelector('#shopCash').textContent=Math.floor(state.cash)}
  function toast(text){const t=document.querySelector('#toast');t.textContent=text;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),1300)}
  function announce(top,main){const e=document.querySelector('#announcement');document.querySelector('#announceTop').textContent=top;document.querySelector('#announceMain').textContent=main;e.classList.remove('hidden');e.animate([{opacity:0,transform:'translate(-50%,-30%) scale(.9)'},{opacity:1,transform:'translate(-50%,-50%) scale(1)'},{opacity:1},{opacity:0}],{duration:2300,easing:'ease-out'});setTimeout(()=>e.classList.add('hidden'),2300)}
  function updateHud(){document.querySelector('#waveText').textContent=Math.max(1,state.wave);document.querySelector('#enemyText').textContent=`${Math.max(0,state.waveTotal-state.spawned+enemies.length)} VERBLEIBEN`;document.querySelector('#cashText').textContent=Math.floor(state.cash);document.querySelector('#shopCash').textContent=Math.floor(state.cash);document.querySelector('#healthText').textContent=`${Math.ceil(Math.max(0,state.health))} / ${state.maxHealth}`;document.querySelector('#armorText').textContent=`${Math.ceil(Math.max(0,state.armor))} / ${state.maxArmor}`;document.querySelector('#healthBar').style.width=`${Math.max(0,state.health/state.maxHealth*100)}%`;document.querySelector('#armorBar').style.width=`${Math.max(0,state.armor/state.maxArmor*100)}%`;document.querySelector('#damageText').textContent=`SCHADEN ${state.damage}`}

  function updateAim() {
    if (touchAiming) {
      aimPoint.set(player.position.x + touchAim.x * 12, 0, player.position.z + touchAim.y * 12);
      return;
    }
    raycaster.setFromCamera(mouse,camera);const hit=new THREE.Vector3();raycaster.ray.intersectPlane(new THREE.Plane(UP,0),hit);if(Number.isFinite(hit.x))aimPoint.copy(hit);
  }
  function updatePlayer(dt) {
    const keyX=(keys.KeyD?1:0)-(keys.KeyA?1:0),keyZ=(keys.KeyS?1:0)-(keys.KeyW?1:0);
    const move=new THREE.Vector3(keyX+touchMove.x,0,keyZ+touchMove.y);
    const strength=Math.min(1,move.length());
    if(move.lengthSq()){move.normalize().multiplyScalar(state.speed*dt*strength);player.position.add(move);player.position.x=THREE.MathUtils.clamp(player.position.x,-ARENA,ARENA);player.position.z=THREE.MathUtils.clamp(player.position.z,-ARENA,ARENA)}
    const d=aimPoint.clone().sub(player.position);d.y=0;if(d.lengthSq()>.1)player.rotation.y=Math.atan2(-d.x,-d.z);
    if(state.fireHeld||touchFiring)createBullet();
  }
  function updateEnemies(dt,time) {
    for(let i=enemies.length-1;i>=0;i--){const e=enemies[i],u=e.userData,to=player.position.clone().sub(e.position),dist=to.length();e.rotation.y=Math.atan2(to.x,to.z);
      if(u.type==='thrower'&&dist<12){if(time-u.lastThrow>2.7){throwRock(e);u.lastThrow=time}if(dist<6)e.position.addScaledVector(to.normalize(),-u.spec.speed*dt*.55);else if(dist>9)e.position.addScaledVector(to.normalize(),u.spec.speed*dt)}
      else if(dist>1.05*u.spec.scale)e.position.addScaledVector(to.normalize(),u.spec.speed*dt);
      else if(time-u.lastAttack>.75){hurt(u.spec.damage);u.lastAttack=time;burst(player.position.clone().add(new THREE.Vector3(0,1,0)),0xe54b3f,3,1.2)}
      u.bar.lookAt(camera.position);u.hpBar.scale.x=Math.max(.001,u.hp/u.maxHp);u.hpBar.position.x=-(1-u.hp/u.maxHp)*.44;
    }
  }
  function updateProjectiles(dt) {
    for(let i=bullets.length-1;i>=0;i--){const b=bullets[i];b.position.addScaledVector(b.userData.velocity,dt);b.userData.life-=dt;let hit=false;for(let j=enemies.length-1;j>=0;j--){const e=enemies[j];if(b.position.distanceTo(e.position.clone().add(new THREE.Vector3(0,1,0)))<.65*e.userData.spec.scale){e.userData.hp-=b.userData.damage;burst(b.position,0xffd271,4,1.5);if(e.userData.hp<=0)killEnemy(e,j);hit=true;break}}if(hit||b.userData.life<=0){scene.remove(b);bullets.splice(i,1)}}
    for(let i=rocks.length-1;i>=0;i--){const r=rocks[i];r.position.addScaledVector(r.userData.velocity,dt);r.userData.velocity.y-=8.4*dt;r.rotation.x+=dt*6;r.rotation.z+=dt*4;r.userData.life-=dt;if(r.position.distanceTo(player.position.clone().add(new THREE.Vector3(0,1,0)))<.75){hurt(r.userData.damage);burst(r.position,0x77736b,6,2);scene.remove(r);rocks.splice(i,1)}else if(r.position.y<0||r.userData.life<0){burst(r.position,0x77736b,4,1);scene.remove(r);rocks.splice(i,1)}}
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.position.addScaledVector(p.userData.velocity,dt);p.userData.velocity.y-=5*dt;p.userData.life-=dt;p.scale.setScalar(Math.max(.01,p.userData.life*2));if(p.userData.life<=0){scene.remove(p);particles.splice(i,1)}}
  }
  function updateCamera(dt){const target=player.position.clone().add(new THREE.Vector3(0,17,12));camera.position.lerp(target,1-Math.pow(.0003,dt));camera.lookAt(player.position.x,0,player.position.z-1.8)}
  function loop(){requestAnimationFrame(loop);const dt=Math.min(clock.getDelta(),.04),time=performance.now()/1000;updateAim();
    if(state.running&&!state.gameOver){updatePlayer(dt);state.spawnTimer-=dt;if(state.spawned<state.waveTotal&&state.spawnTimer<=0){spawnEnemy();state.spawnTimer=Math.max(.28,1.05-state.wave*.045)}updateEnemies(dt,time);updateProjectiles(dt);if(state.spawned>=state.waveTotal&&enemies.length===0)finishWave()}
    else updateProjectiles(dt);
    updateCamera(dt);renderer.render(scene,camera)}

  addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Space'){state.fireHeld=true;e.preventDefault()}});addEventListener('keyup',e=>{keys[e.code]=false;if(e.code==='Space')state.fireHeld=false});
  addEventListener('mousemove',e=>{mouse.x=e.clientX/innerWidth*2-1;mouse.y=-(e.clientY/innerHeight*2-1)});addEventListener('mousedown',e=>{if(e.button===0)state.fireHeld=true});addEventListener('mouseup',()=>state.fireHeld=false);

  function setupTouchStick(id, vector, isAim = false) {
    const zone=document.querySelector(id),knob=zone.querySelector('.stick-knob');
    let pointerId=null;
    const update=e=>{
      if(e.pointerId!==pointerId)return;
      const ring=zone.querySelector('.stick-ring').getBoundingClientRect();
      const cx=ring.left+ring.width/2,cy=ring.top+ring.height/2,max=ring.width*.38;
      let dx=e.clientX-cx,dy=e.clientY-cy;const distance=Math.hypot(dx,dy);
      if(distance>max){dx=dx/distance*max;dy=dy/distance*max}
      knob.style.transform=`translate(${dx}px,${dy}px)`;
      vector.set(dx/max,dy/max);
      if(vector.length()<.12)vector.set(0,0);
      if(isAim){touchAiming=vector.lengthSq()>.02;touchFiring=touchAiming}
      e.preventDefault();
    };
    const release=e=>{
      if(e.pointerId!==pointerId)return;
      pointerId=null;vector.set(0,0);knob.style.transform='translate(0,0)';zone.classList.remove('active');
      if(isAim){touchAiming=false;touchFiring=false}
      e.preventDefault();
    };
    zone.addEventListener('pointerdown',e=>{if(pointerId!==null)return;pointerId=e.pointerId;zone.setPointerCapture(pointerId);zone.classList.add('active');update(e)},{passive:false});
    zone.addEventListener('pointermove',update,{passive:false});
    zone.addEventListener('pointerup',release,{passive:false});
    zone.addEventListener('pointercancel',release,{passive:false});
    zone.addEventListener('contextmenu',e=>e.preventDefault());
  }
  setupTouchStick('#moveStick',touchMove,false);
  setupTouchStick('#aimStick',touchAim,true);
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.75))});
  document.querySelector('#startButton').onclick=()=>{document.querySelector('#start').classList.add('hidden');startWave()};
  document.querySelector('#nextWaveButton').onclick=startWave;
  document.querySelector('#restartButton').onclick=()=>location.reload();
  updateHud();renderShop();loop();
  setTimeout(()=>{const l=document.querySelector('#loading');l.style.opacity='0';setTimeout(()=>l.remove(),500)},650);
})();
