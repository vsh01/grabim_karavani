// Полноэкранные панели: меню, выбор фракции, лавки, инвентарь, карта,
// протезная мастерская, военный стол, экран смерти.
import { PLAYABLE_FACTIONS, FACTIONS } from '../systems/factions.js';
import { ITEMS, SHOPS, SLOT, priceFor, prostheticTarget } from '../systems/items.js';
import { LIMB_LABEL, LIMB_GENITIVE } from '../systems/injury.js';
import { listSaves, formatSaveDate, SLOTS } from '../core/save.js';
import { ZONES, WORLD_HALF, CROSSROADS } from '../world/zones.js';
import { plural } from '../core/utils.js';

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Screens {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('screen');
    this.current = null;
    this._mapTimer = null;
  }

  get isOpen() {
    return this.current !== null;
  }

  close() {
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
    this.current = null;
    if (this._mapTimer) {
      clearInterval(this._mapTimer);
      this._mapTimer = null;
    }
    this.game.onScreenClosed?.();
  }

  _open(name, html) {
    this.current = name;
    this.root.classList.remove('hidden');
    this.root.innerHTML = `<div class="panel">${html}</div>`;
    this.game.onScreenOpened?.(name);
  }

  _on(selector, handler) {
    this.root.querySelectorAll(selector).forEach((el) => {
      el.addEventListener('click', (e) => handler(el, e));
    });
  }

  // ─────────────────────────── главное меню ───────────────────────────

  showMainMenu() {
    const saves = listSaves().filter((s) => !s.empty);
    this._open(
      'main',
      `
      <h1>ГРАБИМ КОРОВАНЫ</h1>
      <div class="subtitle">3D-экшон про лесных эльфов, охрану дворца и Злодея</div>
      <button class="btn" data-act="new"><b>Новая игра</b><small>Выбрать фракцию и начать</small></button>
      <button class="btn" data-act="load" ${saves.length ? '' : 'disabled'}>
        <b>Загрузить игру</b><small>${saves.length ? `сохранений: ${saves.length}` : 'сохранений нет'}</small>
      </button>
      <button class="btn" data-act="help"><b>Управление</b><small>Клавиши и что вообще делать</small></button>
      <div class="close-hint">Игра сохраняется в браузере. Чтобы играть, нажми на экран — курсор захватится.</div>
    `,
    );
    this._on('[data-act]', (el) => {
      const act = el.dataset.act;
      if (act === 'new') this.showFactionSelect();
      else if (act === 'load') this.showLoadMenu();
      else if (act === 'help') this.showHelp(true);
    });
  }

  showFactionSelect() {
    const cards = PLAYABLE_FACTIONS.map(
      (f) => `
      <div class="faction-card ${f.id}" data-faction="${f.id}">
        <h3>${esc(f.name)}</h3>
        <div class="tagline">${esc(f.tagline)}</div>
        <p>${esc(f.description)}</p>
        <ul>${f.perks.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      </div>`,
    ).join('');

    this._open(
      'faction',
      `
      <h1>ЗА КОГО ИГРАЕМ</h1>
      <div class="subtitle">Мир один, но с трёх сторон он выглядит по-разному</div>
      <div class="faction-grid">${cards}</div>
      <button class="btn" data-act="back">Назад</button>
    `,
    );
    this._on('[data-faction]', (el) => this.game.startNewGame(el.dataset.faction));
    this._on('[data-act="back"]', () => this.showMainMenu());
  }

  showLoadMenu(fromPause = false) {
    const saves = listSaves();
    const rows = saves
      .map((s) => {
        const label = s.slot === 'auto' ? 'Автосохранение' : `Слот ${s.slot}`;
        if (s.empty) {
          return `<button class="btn" disabled><b>${label}</b><small>пусто</small></button>`;
        }
        const f = FACTIONS[s.faction];
        return `<button class="btn" data-load="${s.slot}">
          <b>${label} — ${esc(f?.short || '?')}</b>
          <small>${esc(s.zone)} · ур. ${s.level} · ${s.gold} золота · ${formatSaveDate(s.savedAt)}</small>
        </button>`;
      })
      .join('');

    this._open(
      'load',
      `
      <h2>Загрузить игру</h2>
      ${rows}
      <button class="btn" data-act="back">Назад</button>
    `,
    );
    this._on('[data-load]', (el) => this.game.loadFromSlot(el.dataset.load));
    this._on('[data-act="back"]', () => (fromPause ? this.showPause() : this.showMainMenu()));
  }

  showSaveMenu() {
    const saves = listSaves();
    const rows = SLOTS.filter((s) => s !== 'auto')
      .map((slot) => {
        const s = saves.find((x) => x.slot === slot);
        const sub = s && !s.empty ? `перезаписать · ${formatSaveDate(s.savedAt)}` : 'пусто';
        return `<button class="btn" data-save="${slot}"><b>Слот ${slot}</b><small>${sub}</small></button>`;
      })
      .join('');
    this._open(
      'save',
      `
      <h2>Сохранить игру</h2>
      <div class="note">Сохраняются увечья, протезы, снаряжение, золото, репутация и задание.</div>
      ${rows}
      <button class="btn" data-act="back">Назад</button>
    `,
    );
    this._on('[data-save]', (el) => {
      this.game.saveToSlot(el.dataset.save);
      this.close();
    });
    this._on('[data-act="back"]', () => this.showPause());
  }

  showPause() {
    this._open(
      'pause',
      `
      <h1>ПАУЗА</h1>
      <div class="subtitle">${esc(this.game.factionName)} · ${esc(this.game.world.currentZone.name)}</div>
      <button class="btn" data-act="resume"><b>Продолжить</b></button>
      <button class="btn" data-act="save"><b>Сохранить игру</b></button>
      <button class="btn" data-act="load"><b>Загрузить игру</b></button>
      <button class="btn" data-act="stats"><b>Герой и репутация</b></button>
      <button class="btn" data-act="help"><b>Управление</b></button>
      <button class="btn" data-act="quit"><b>Выйти в главное меню</b><small>несохранённое пропадёт</small></button>
    `,
    );
    this._on('[data-act]', (el) => {
      switch (el.dataset.act) {
        case 'resume': this.close(); break;
        case 'save': this.showSaveMenu(); break;
        case 'load': this.showLoadMenu(true); break;
        case 'stats': this.showStats(); break;
        case 'help': this.showHelp(); break;
        case 'quit': this.game.quitToMenu(); break;
      }
    });
  }

  showHelp(fromMain = false) {
    this._open(
      'help',
      `
      <h2>Управление</h2>
      <div class="two-col">
        <div>
          <div class="col-title">ДВИЖЕНИЕ</div>
          <table class="stat-table">
            <tr><td>Ходить</td><td>W A S D</td></tr>
            <tr><td>Бежать</td><td>Shift</td></tr>
            <tr><td>Прыгать</td><td>Пробел</td></tr>
            <tr><td>Осмотреться</td><td>мышь</td></tr>
            <tr><td>Вид от первого лица</td><td>V</td></tr>
          </table>
          <div class="col-title" style="margin-top:16px">БОЙ</div>
          <table class="stat-table">
            <tr><td>Удар / выстрел</td><td>ЛКМ</td></tr>
            <tr><td>Блок</td><td>ПКМ</td></tr>
            <tr><td>Цель в ноги — рубишь ноги</td><td>смотри вниз</td></tr>
            <tr><td>Цель в голову — выбьешь глаз</td><td>смотри вверх</td></tr>
          </table>
        </div>
        <div>
          <div class="col-title">ДЕЙСТВИЯ</div>
          <table class="stat-table">
            <tr><td>Поговорить / ограбить корован</td><td>E</td></tr>
            <tr><td>Инвентарь</td><td>I</td></tr>
            <tr><td>Карта</td><td>M</td></tr>
            <tr><td>Перевязать (бинт)</td><td>B</td></tr>
            <tr><td>Выпить зелье</td><td>H</td></tr>
            <tr><td>Пауза / меню</td><td>Esc</td></tr>
          </table>
          <div class="col-title" style="margin-top:16px">ГЛАВНОЕ ПРО УВЕЧЬЯ</div>
          <div class="note warn">
            Отрубленная рука или нога кровоточит. Не перевяжешь бинтом за минуту с небольшим —
            умрёшь. Без ноги будешь ползать, пока не купишь коляску или протез.
            Выбитый глаз закрывает полэкрана — помогает стеклянный глаз.
          </div>
        </div>
      </div>
      <button class="btn" data-act="back" style="margin-top:18px">Назад</button>
    `,
    );
    this._on('[data-act="back"]', () => (fromMain ? this.showMainMenu() : this.showPause()));
  }

  showStats() {
    const p = this.game.player;
    const rep = this.game.reputation;
    const repRows = Object.values(FACTIONS)
      .map((f) => {
        const v = rep.get(f.id);
        const width = Math.abs(v) / 2;
        const side = v >= 0 ? `left:50%;width:${width}%` : `right:50%;width:${width}%`;
        return `<tr><td>${esc(f.name)}<div class="rep-bar"><i class="${v < 0 ? 'neg' : ''}" style="${side}"></i></div></td>
          <td>${v > 0 ? '+' : ''}${v} · ${esc(rep.label(f.id))}</td></tr>`;
      })
      .join('');

    const inj = p.injuries.describe();
    this._open(
      'stats',
      `
      <h2>Герой</h2>
      <div class="two-col">
        <div>
          <div class="col-title">ХАРАКТЕРИСТИКИ</div>
          <table class="stat-table">
            <tr><td>Фракция</td><td>${esc(this.game.factionName)}</td></tr>
            <tr><td>Уровень</td><td>${p.level}</td></tr>
            <tr><td>Опыт</td><td>${Math.floor(p.xp)} / ${p.xpToNext}</td></tr>
            <tr><td>Здоровье</td><td>${Math.ceil(p.health)} / ${p.maxHealth}</td></tr>
            <tr><td>Золото</td><td>${Math.floor(p.gold)}</td></tr>
            <tr><td>Скорость</td><td>${(p.injuries.speedMultiplier * 100).toFixed(0)}%</td></tr>
            <tr><td>Оружие</td><td>${esc(p.weapon.name)}</td></tr>
            <tr><td>Броня</td><td>${esc(p.inventory.armor?.name || '—')}</td></tr>
          </table>
          <div class="col-title" style="margin-top:16px">СОСТОЯНИЕ ТЕЛА</div>
          <div class="note ${inj.length ? 'warn' : ''}">${inj.length ? esc(inj.join(', ')) : 'Всё на месте.'}</div>
        </div>
        <div>
          <div class="col-title">РЕПУТАЦИЯ</div>
          <table class="stat-table">${repRows}</table>
          <div class="col-title" style="margin-top:16px">КОРОВАНЫ</div>
          <table class="stat-table">
            <tr><td>Ограблено</td><td>${this.game.caravans.robbedCount}</td></tr>
            <tr><td>Взято добра на</td><td>${this.game.caravans.totalLooted} золота</td></tr>
            <tr><td>Заданий выполнено</td><td>${this.game.orders.completed}</td></tr>
          </table>
        </div>
      </div>
      <button class="btn" data-act="back" style="margin-top:18px">Назад</button>
    `,
    );
    this._on('[data-act="back"]', () => this.showPause());
  }

  // ─────────────────────────── торговля ───────────────────────────

  showShop(shopId) {
    const shop = SHOPS[shopId];
    if (!shop) return;
    const p = this.game.player;

    const stock = shop.stock
      .map((id) => {
        const item = ITEMS[id];
        const price = priceFor(id, shopId);
        const afford = p.gold >= price;
        return `<button class="btn" data-buy="${id}" ${afford ? '' : 'disabled'}>
          <span class="price">${price} ✦</span><b>${esc(item.name)}</b>
          <small>${esc(item.desc || '')}</small>
        </button>`;
      })
      .join('');

    const mine = p.inventory
      .list()
      .filter((it) => it.slot !== SLOT.PROSTHETIC)
      .map((it) => {
        const price = priceFor(it.id, shopId, true);
        return `<button class="btn" data-sell="${it.id}">
          <span class="price">+${price} ✦</span><b>${esc(it.name)}${it.count > 1 ? ` ×${it.count}` : ''}</b>
          <small>продать одну штуку</small>
        </button>`;
      })
      .join('') || '<div class="note">Продавать нечего.</div>';

    this._open(
      'shop',
      `
      <h2>${esc(shop.name)}</h2>
      <div class="money-line">У тебя: ${Math.floor(p.gold)} ✦</div>
      <div class="two-col">
        <div><div class="col-title">КУПИТЬ</div><div class="list">${stock}</div></div>
        <div><div class="col-title">ПРОДАТЬ</div><div class="list">${mine}</div></div>
      </div>
      <button class="btn" data-act="close" style="margin-top:16px">Уйти</button>
      <div class="close-hint">Купленное оружие и броня надеваются сразу, если они лучше текущих.</div>
    `,
    );
    this._on('[data-buy]', (el) => {
      this.game.buyItem(el.dataset.buy, shopId);
      this.showShop(shopId);
    });
    this._on('[data-sell]', (el) => {
      this.game.sellItem(el.dataset.sell, shopId);
      this.showShop(shopId);
    });
    this._on('[data-act="close"]', () => this.close());
  }

  /** Протезная мастерская: главный магазин этой игры. */
  showProsthetist(shopId = 'prosthetist') {
    const p = this.game.player;
    const inj = p.injuries;
    const shop = SHOPS.prosthetist;

    const needs = [];
    for (const part of Object.keys(inj.missing)) {
      if (inj.missing[part] && !inj.prosthetic[part]) needs.push(`нет ${LIMB_GENITIVE[part]}`);
    }
    if (inj.eyesLost) needs.push(`выбит глаз ×${inj.eyesLost}`);

    const rows = shop.stock
      .map((id) => {
        const item = ITEMS[id];
        const price = priceFor(id, 'prosthetist');
        let usable = true;
        let why = item.desc || '';
        if (item.slot === SLOT.PROSTHETIC) {
          const target = prostheticTarget(id, inj);
          if (item.part === 'wheelchair') {
            usable = !inj.hasWheelchair;
            why = inj.hasWheelchair ? 'коляска уже есть' : item.desc;
          } else if (!target) {
            usable = false;
            why = 'ставить некуда — всё на месте';
          } else if (target !== 'eye' && target !== 'wheelchair') {
            why = `встанет на место: ${LIMB_LABEL[target]}`;
          }
        }
        const afford = p.gold >= price;
        return `<button class="btn" data-buy="${id}" ${usable && afford ? '' : 'disabled'}>
          <span class="price">${price} ✦</span><b>${esc(item.name)}</b>
          <small>${esc(why)}</small>
        </button>`;
      })
      .join('');

    const chairLine =
      inj.hasWheelchair && inj.legsLost > 0
        ? `<button class="btn" data-act="chair">
             <b>${inj.usesWheelchair ? 'Слезть с коляски' : 'Сесть в коляску'}</b>
             <small>${inj.usesWheelchair ? 'будешь ползать' : 'быстрее, чем ползать, но не попрыгаешь'}</small>
           </button>`
        : '';

    const healPrice = this.game.healPrice();
    this._open(
      'prosthetist',
      `
      <h2>${esc(shop.name)}</h2>
      <div class="money-line">У тебя: ${Math.floor(p.gold)} ✦</div>
      <div class="two-col">
        <div>
          <div class="col-title">ЧТО С ТОБОЙ</div>
          <div class="note ${needs.length ? 'warn' : ''}">${needs.length ? esc(needs.join(', ')) : 'Всё на месте, ходишь ровно.'}</div>
          ${inj.isBleeding ? '<div class="note warn">Кровь всё ещё идёт! Перевязка входит в лечение.</div>' : ''}
          <button class="btn" data-act="heal" ${p.gold >= healPrice ? '' : 'disabled'}>
            <span class="price">${healPrice} ✦</span><b>Подлечить и перевязать</b>
            <small>полное здоровье, кровь останавливается</small>
          </button>
          ${chairLine}
        </div>
        <div>
          <div class="col-title">ПРОТЕЗЫ И ТОВАР</div>
          <div class="list">${rows}</div>
        </div>
      </div>
      <button class="btn" data-act="close" style="margin-top:16px">Уйти</button>
    `,
    );
    this._on('[data-buy]', (el) => {
      this.game.buyProsthetic(el.dataset.buy);
      this.showProsthetist(shopId);
    });
    this._on('[data-act="heal"]', () => {
      this.game.payForHealing();
      this.showProsthetist(shopId);
    });
    this._on('[data-act="chair"]', () => {
      this.game.toggleWheelchair();
      this.showProsthetist(shopId);
    });
    this._on('[data-act="close"]', () => this.close());
  }

  showHealer() {
    const p = this.game.player;
    const price = this.game.healPrice();
    this._open(
      'healer',
      `
      <h2>Лекарь</h2>
      <div class="money-line">У тебя: ${Math.floor(p.gold)} ✦</div>
      <div class="note ${p.injuries.isBleeding ? 'warn' : ''}">
        ${p.injuries.isBleeding
          ? 'Кровь идёт. Если не остановить — умрёшь. Лечение перевяжет раны.'
          : 'Раны и усталость лечатся, но отрубленное назад не прирастёт — это к протезной мастерской.'}
      </div>
      <button class="btn" data-act="heal" ${p.gold >= price ? '' : 'disabled'}>
        <span class="price">${price} ✦</span><b>Лечиться</b>
        <small>здоровье до полного, кровь останавливается</small>
      </button>
      <button class="btn" data-act="close">Уйти</button>
    `,
    );
    this._on('[data-act="heal"]', () => {
      this.game.payForHealing();
      this.showHealer();
    });
    this._on('[data-act="close"]', () => this.close());
  }

  // ─────────────────────────── инвентарь ───────────────────────────

  showInventory() {
    const p = this.game.player;
    const items = p.inventory.list();
    const rows = items.length
      ? items
          .map((it) => {
            const equipped = p.inventory.equippedWeapon === it.id || p.inventory.equippedArmor === it.id;
            const canEquip = it.slot === SLOT.WEAPON || it.slot === SLOT.ARMOR;
            const canUse = it.slot === SLOT.USE && (it.heal || it.id === 'bandage');
            const action = canEquip ? 'надеть' : canUse ? 'использовать' : '—';
            return `<button class="btn" data-item="${it.id}" ${canEquip || canUse ? '' : 'disabled'}>
              <span class="price">${equipped ? 'НАДЕТО' : action}</span>
              <b>${esc(it.name)}${it.count > 1 ? ` ×${it.count}` : ''}</b>
              <small>${esc(it.desc || '')}</small>
            </button>`;
          })
          .join('')
      : '<div class="note">Пусто.</div>';

    this._open(
      'inventory',
      `
      <h2>Мешок</h2>
      <div class="money-line">${Math.floor(p.gold)} ✦ · ${items.length} ${plural(items.length, 'вид', 'вида', 'видов')} вещей</div>
      <div class="list">${rows}</div>
      <button class="btn" data-act="close" style="margin-top:14px">Закрыть <small>I или Esc</small></button>
    `,
    );
    this._on('[data-item]', (el) => {
      this.game.useOrEquip(el.dataset.item);
      this.showInventory();
    });
    this._on('[data-act="close"]', () => this.close());
  }

  // ─────────────────────────── командиры ───────────────────────────

  showCommander() {
    const orders = this.game.orders;
    const current = orders.current;
    let body;
    if (current && !current.done) {
      const d = orders.describe();
      body = `
        <div class="col-title">ТЕКУЩИЙ ПРИКАЗ</div>
        <div class="note"><b>${esc(d.title)}</b><br>${esc(current.text)}</div>
        <div class="note">${d.progress ? `Выполнено: ${esc(d.progress)}` : 'Иди и сделай.'}</div>
        <button class="btn" data-act="abandon"><b>Отказаться от приказа</b><small>командир этого не любит</small></button>
      `;
    } else {
      const offer = orders.available || orders.offer(this.game.player.faction);
      body = offer
        ? `
        <div class="col-title">НОВЫЙ ПРИКАЗ</div>
        <div class="note"><b>${esc(offer.title)}</b><br>${esc(offer.text)}</div>
        <div class="note">Награда: ${offer.reward.gold} ✦ и ${offer.reward.xp} опыта.</div>
        <button class="btn" data-act="accept"><b>Так точно</b><small>взять приказ</small></button>
      `
        : '<div class="note">Приказов пока нет.</div>';
    }

    const isEmpire = this.game.player.faction === 'empire';
    this._open(
      'commander',
      `
      <h2>${isEmpire ? 'Командир стражи Ратибор' : 'Старейшина Ветвеслав'}</h2>
      ${isEmpire
        ? '<div class="note">Стража служит. Приказы командира не обсуждают — их выполняют.</div>'
        : '<div class="note">Лес помнит всё. Старейшина говорит негромко, но слушают его все.</div>'}
      ${body}
      <button class="btn" data-act="close">Уйти</button>
    `,
    );
    this._on('[data-act="accept"]', () => {
      this.game.acceptOffer();
      this.close();
    });
    this._on('[data-act="abandon"]', () => {
      this.game.orders.abandon();
      this.close();
    });
    this._on('[data-act="close"]', () => this.close());
  }

  /** Военный стол Злодея: тут игрок сам себе командир. */
  showWarTable() {
    const squad = this.game.squad;
    const orders = this.game.orders;
    const alive = squad ? squad.alive.length : 0;
    const current = orders.current;
    const cost = this.game.recruitCost();

    const questBlock =
      current && !current.done
        ? `<div class="note"><b>${esc(current.title)}</b><br>${esc(current.text)}</div>
           <div class="note">${orders.describe().progress || ''}</div>`
        : (() => {
            const offer = orders.available || orders.offer('villain');
            return offer
              ? `<div class="note"><b>${esc(offer.title)}</b><br>${esc(offer.text)}</div>
                 <button class="btn" data-act="accept"><b>Так и сделаем</b><small>взять цель</small></button>`
              : '<div class="note">Планов пока нет.</div>';
          })();

    this._open(
      'wartable',
      `
      <h2>Военный стол</h2>
      <div class="note">Приказов тебе никто не даёт — ты сам командир. Собирай войско и веди куда хочешь.</div>
      <div class="two-col">
        <div>
          <div class="col-title">ВОЙСКО · ${alive} ${plural(alive, 'боец', 'бойца', 'бойцов')}</div>
          <button class="btn" data-act="recruit" ${this.game.player.gold >= cost ? '' : 'disabled'}>
            <span class="price">${cost} ✦</span><b>Нанять бойца</b><small>пополнить отряд</small>
          </button>
          <button class="btn" data-act="follow" ${alive ? '' : 'disabled'}>
            <b>«За мной»</b><small>отряд идёт следом</small>
          </button>
          <button class="btn" data-act="attack" ${alive ? '' : 'disabled'}>
            <b>«На дворец!»</b><small>отряд идёт штурмовать дворец императора</small>
          </button>
          <button class="btn" data-act="hold" ${alive ? '' : 'disabled'}>
            <b>«Держать форт»</b><small>отряд остаётся на месте</small>
          </button>
        </div>
        <div>
          <div class="col-title">ЦЕЛЬ</div>
          ${questBlock}
        </div>
      </div>
      <button class="btn" data-act="close" style="margin-top:16px">Отойти от стола</button>
    `,
    );
    this._on('[data-act]', (el) => {
      switch (el.dataset.act) {
        case 'recruit': this.game.recruitSoldier(); this.showWarTable(); break;
        case 'follow': this.game.commandSquad('follow'); this.close(); break;
        case 'attack': this.game.commandSquad('attack'); this.close(); break;
        case 'hold': this.game.commandSquad('hold'); this.close(); break;
        case 'accept': this.game.acceptOffer(); this.close(); break;
        case 'close': this.close(); break;
      }
    });
  }

  showRest() {
    const p = this.game.player;
    this._open(
      'rest',
      `
      <h2>Отдых</h2>
      <div class="note">
        ${p.injuries.isBleeding
          ? 'Спать с открытой раной нельзя — сначала перевяжись, иначе не проснёшься.'
          : 'Сон восстановит здоровье и силы. Заодно игра сохранится.'}
      </div>
      <button class="btn" data-act="sleep" ${p.injuries.isBleeding ? 'disabled' : ''}>
        <b>Поспать</b><small>полное восстановление + автосохранение</small>
      </button>
      <button class="btn" data-act="save"><b>Просто сохраниться</b></button>
      <button class="btn" data-act="close">Уйти</button>
    `,
    );
    this._on('[data-act]', (el) => {
      if (el.dataset.act === 'sleep') this.game.sleep();
      else if (el.dataset.act === 'save') this.showSaveMenu();
      else this.close();
    });
  }

  showCaravanMaster() {
    const info = this.game.caravans.nearest(this.game.player.position);
    const text = info
      ? `Сейчас на дорогах есть корован: примерно ${Math.round(info.distance)} шагов отсюда, идёт из «${esc(
          ZONES.find((z) => z.id === info.caravan.fromZone)?.name || '?',
        )}» в «${esc(ZONES.find((z) => z.id === info.caravan.toZone)?.name || '?')}». Охраны при нём ${
          info.caravan.livingGuards.length
        }.`
      : 'Сейчас на дорогах пусто. Подожди — корованы ходят постоянно.';

    this._open(
      'caravanmaster',
      `
      <h2>Караванщик Прохор</h2>
      <div class="note">${text}</div>
      <div class="note">Корованы ходят между всеми четырьмя зонами через Большой Перекрёсток.
      Отметки видно на карте (<kbd>M</kbd>). Подойди к повозке и жми <kbd>E</kbd> — но сначала разберись с охраной.</div>
      <button class="btn" data-act="close">Уйти</button>
    `,
    );
    this._on('[data-act="close"]', () => this.close());
  }

  // ─────────────────────────── карта ───────────────────────────

  showMap() {
    this._open(
      'map',
      `
      <h2>Карта</h2>
      <canvas id="map-canvas" width="560" height="560"></canvas>
      <div class="map-legend">
        <span class="l-you">ты</span>
        <span class="l-elves">эльфы</span>
        <span class="l-empire">император</span>
        <span class="l-villain">злодей</span>
        <span class="l-humans">люди</span>
        <span class="l-caravan">корован</span>
      </div>
      <button class="btn" data-act="close" style="margin-top:14px">Закрыть <small>M или Esc</small></button>
    `,
    );
    this._on('[data-act="close"]', () => this.close());
    this._drawMap();
    this._mapTimer = setInterval(() => this._drawMap(), 500);
  }

  _drawMap() {
    const canvas = this.root.querySelector('#map-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const toPx = (x, z) => [
      ((x + WORLD_HALF) / (WORLD_HALF * 2)) * size,
      ((z + WORLD_HALF) / (WORLD_HALF * 2)) * size,
    ];

    ctx.fillStyle = '#12100c';
    ctx.fillRect(0, 0, size, size);

    // Зоны.
    for (const zone of ZONES) {
      const [px, pz] = toPx(zone.center.x, zone.center.z);
      const r = (zone.radius / (WORLD_HALF * 2)) * size;
      const grad = ctx.createRadialGradient(px, pz, 0, px, pz, r);
      const color = {
        elves: '111,194,90',
        empire: '224,106,106',
        villain: '169,122,208',
        humans: '216,178,104',
      }[zone.id];
      grad.addColorStop(0, `rgba(${color},0.42)`);
      grad.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, pz, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Дороги.
    ctx.strokeStyle = 'rgba(200,161,46,0.55)';
    ctx.lineWidth = 3;
    const [ccx, ccz] = toPx(CROSSROADS.x, CROSSROADS.z);
    for (const zone of ZONES) {
      const [hx, hz] = toPx(zone.hub.x, zone.hub.z);
      ctx.beginPath();
      ctx.moveTo(hx, hz);
      ctx.lineTo(ccx, ccz);
      ctx.stroke();
    }

    // Названия и метки поселений.
    ctx.font = '12px Georgia';
    ctx.textAlign = 'center';
    for (const zone of ZONES) {
      const [hx, hz] = toPx(zone.hub.x, zone.hub.z);
      ctx.fillStyle = '#e8dcc0';
      ctx.beginPath();
      ctx.arc(hx, hz, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c8a12e';
      ctx.fillText(zone.hub.name, hx, hz - 10);
      ctx.fillStyle = 'rgba(232,220,192,0.6)';
      ctx.fillText(`${zone.index}. ${zone.name}`, hx, hz + 20);
    }
    ctx.fillStyle = '#c8a12e';
    ctx.fillText('Большой Перекрёсток', ccx, ccz - 9);

    // Корованы.
    for (const c of this.game.caravans.caravans) {
      if (c.robbed || c.finished) continue;
      const [px, pz] = toPx(c.position.x, c.position.z);
      ctx.fillStyle = '#ff8c2a';
      ctx.beginPath();
      ctx.arc(px, pz, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Игрок и его взгляд.
    const p = this.game.player;
    if (p) {
      const [px, pz] = toPx(p.position.x, p.position.z);
      ctx.save();
      ctx.translate(px, pz);
      ctx.rotate(-p.yaw + Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5.5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5.5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.strokeStyle = 'rgba(200,161,46,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }

  // ─────────────────────────── смерть ───────────────────────────

  showDeath(cause) {
    const reasons = {
      bleedout: 'Ты истёк кровью. Надо было перевязать культю бинтом.',
      wound: 'Тебя убили в бою.',
      decapitated: 'Тебе отрубили голову.',
      fall: 'Ты разбился при падении.',
    };
    const saves = listSaves().filter((s) => !s.empty);
    this._open(
      'death',
      `
      <h1 style="color:var(--blood)">СМЕРТЬ</h1>
      <div class="subtitle">${esc(reasons[cause] || reasons.wound)}</div>
      <button class="btn" data-act="load" ${saves.length ? '' : 'disabled'}>
        <b>Загрузить сохранение</b><small>${saves.length ? 'вернуться к последнему' : 'сохранений нет'}</small>
      </button>
      <button class="btn" data-act="respawn"><b>Очнуться у своих</b>
        <small>вернёшься в родное поселение, но потеряешь половину золота</small></button>
      <button class="btn" data-act="menu"><b>В главное меню</b></button>
    `,
    );
    this._on('[data-act]', (el) => {
      switch (el.dataset.act) {
        case 'load': this.showLoadMenu(); break;
        case 'respawn': this.game.respawnPlayer(); break;
        case 'menu': this.game.quitToMenu(); break;
      }
    });
  }
}
