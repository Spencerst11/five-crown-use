// ============================================================
// avatar.js — shared avatar definitions & rendering
// Single source of truth for animal IDs, colors, image paths,
// and the paint routine used everywhere an avatar is shown.
//
// avatar object shape: { animal: <id|'none'>, color: <id> }
//   animal id is a stable string: 'penguin','dragon','capybara',
//   'turtle','dino','poodle','jellyfish', or 'none'.
//   (Earlier versions stored an emoji here — see LEGACY_EMOJI below;
//    migrate() rewrites those to the new ids so old saved sessions
//    and in-flight payloads keep working.)
// ============================================================

const Avatar = (() => {

  // id -> hex swatch (the color the player picks; becomes the circle bg)
  const COLOR_MAP = {
    red:'#e53e3e', pink:'#d53f8c', periwinkle:'#7b8cde',
    sage:'#68a57a', orange:'#ed8936', gold:'#d4a017',
  };
  const COLOR_NAMES = {
    red:'Red', pink:'Berry Pink', periwinkle:'Periwinkle',
    sage:'Sage', orange:'Orange', gold:'Gold',
  };

  // id -> display name
  const ANIMAL_NAMES = {
    penguin:'Penguin', dragon:'Dragon', capybara:'Capybara',
    turtle:'Turtle', dino:'Dino', poodle:'Poodle',
    jellyfish:'Jellyfish', none:'None',
  };

  // id -> artwork file in images/avatars/
  const ANIMAL_IMG = {
    penguin:'penguin.png', dragon:'dragon.png', capybara:'capybara.png',
    turtle:'turtle.png',  dino:'dino.png',   poodle:'poodle.png',
    jellyfish:'jellyfish.png',
  };

  // ordered list for building pickers
  const ANIMAL_ORDER = ['penguin','dragon','capybara','turtle','dino','poodle','jellyfish'];

  // Old emoji values -> new ids (for migrating saved sessions / old clients)
  const LEGACY_EMOJI = {
    '🐧':'penguin', '🐉':'dragon', '🦫':'capybara', '🐢':'turtle',
    '🦕':'dino', '🐩':'poodle', '🪼':'jellyfish', '🚫':'none',
  };

  function migrate(avatar) {
    const a = avatar ? { ...avatar } : { animal:'none', color:'gold' };
    if (a.animal && LEGACY_EMOJI[a.animal]) a.animal = LEGACY_EMOJI[a.animal];
    if (!a.animal || !(a.animal in ANIMAL_NAMES)) a.animal = 'none';
    if (!(a.color in COLOR_MAP)) a.color = 'gold';
    return a;
  }

  function bg(av)        { return COLOR_MAP[migrate(av).color] || COLOR_MAP.gold; }
  function hasImage(av)  { const a = migrate(av); return a.animal !== 'none' && !!ANIMAL_IMG[a.animal]; }
  function imageFile(av) { const a = migrate(av); return ANIMAL_IMG[a.animal] || null; }
  function imagePath(av) { const f = imageFile(av); return f ? `images/avatars/${f}` : null; }
  function name(av)      { return ANIMAL_NAMES[migrate(av).animal] || 'None'; }
  function colorName(av) { return COLOR_NAMES[migrate(av).color] || 'Gold'; }

  function initials(playerName) {
    return (playerName || '?').split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0,2);
  }

  // Paint an avatar into an existing element: sets the color background,
  // then either drops in the animal image or falls back to initials.
  // opts.fontScale lets small fallbacks (final-row etc.) tune initials size.
  function paint(el, avatar, playerName, opts = {}) {
    const a = migrate(avatar);
    el.style.background = bg(a);
    el.textContent = '';
    // clear any prior image child
    const old = el.querySelector('img.avatar-img');
    if (old) old.remove();
    if (hasImage(a)) {
      const img = document.createElement('img');
      img.className = 'avatar-img';
      img.src = imagePath(a);
      img.alt = name(a);
      img.draggable = false;
      el.appendChild(img);
    } else {
      if (opts.fontScale) el.style.fontSize = opts.fontScale;
      if (opts.fontFamily) el.style.fontFamily = opts.fontFamily;
      el.textContent = initials(playerName);
    }
    return el;
  }

  return {
    COLOR_MAP, COLOR_NAMES, ANIMAL_NAMES, ANIMAL_IMG, ANIMAL_ORDER,
    migrate, bg, hasImage, imageFile, imagePath, name, colorName,
    initials, paint,
  };
})();

if (typeof window !== 'undefined') window.Avatar = Avatar;
