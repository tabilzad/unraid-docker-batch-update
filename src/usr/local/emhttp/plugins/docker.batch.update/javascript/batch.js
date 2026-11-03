/* Docker Batch Update
 *
 * Everything lives in the dbu namespace because this tab shares the document
 * with the stock Docker Containers tab (and its global docker.js functions).
 *
 * The page never updates anything itself. It hands the selection to Unraid's
 * update_container script exactly like the stock "Update All" button, then
 * polls the container list while that script runs. Docker gives a recreated
 * container a new ID, so a selected container counts as updated once its ID
 * differs from the one recorded when the run started. That works for normal
 * and forced updates alike and needs nothing from the stock progress log.
 */
var dbu = {
  base: '/plugins/docker.batch.update',
  containers: [],
  byName: {},
  selected: {},
  view: 'available',     // 'available' | 'all' | 'running'
  query: '',
  rawQuery: '',
  checkedAt: 0,          // unix time of the last stock update check, 0 = never
  serverNow: 0,          // server clock when the list was loaded
  loadedAt: 0,           // browser clock when the list was loaded
  busy: false,           // the stock updater is running (ours or someone else's)
  busyTimer: null,
  checking: false,       // "Check for Updates" in flight
  run: null,             // our run: {names, before, status, timer}
  result: null,          // last finished run: {status, updated, failed}
  lastClick: null,       // index into visible() for shift-click ranges
  pollMs: 3000,

  // Safe in both text and attribute context. (jQuery's .text().html() trick
  // leaves quotes alone, so it is not safe inside attributes.)
  esc: function(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  },

  // Uppercase pill for states; tag keeps the text as is (container names).
  badge: function(text, tone, icon) {
    return '<span class="dbu-badge" data-tone="' + tone + '">' + (icon ? '<i class="fa ' + icon + '"></i>' : '') + dbu.esc(text) + '</span>';
  },
  tag: function(text, tone, icon) {
    return '<span class="dbu-tag" data-tone="' + tone + '">' + (icon ? '<i class="fa ' + icon + '"></i>' : '') + dbu.esc(text) + '</span>';
  },

  /* ---------------------------------------------------------------- data */

  load: function(cb) {
    $.getJSON(dbu.base + '/include/ContainerList.php', function(data) {
      dbu.containers = data.containers || [];
      dbu.byName = {};
      dbu.containers.forEach(function(ct) { dbu.byName[ct.name] = ct; });
      dbu.checkedAt = data.checked_at || 0;
      dbu.serverNow = data.now || Math.floor(Date.now() / 1000);
      dbu.loadedAt = Date.now();
      dbu.prune();
      dbu.render();
      if (cb) cb(true);
    }).fail(function() {
      $('#dbu-list').html('<tr><td colspan="7" class="dbu-loading dbu-error"><i class="fa fa-exclamation-triangle"></i> ' + dbu.esc(dbuText.error) + '</td></tr>');
      if (cb) cb(false);
    });
  },

  // A container can be picked when the stock updater can handle it, and either
  // it has an update available or the view allows force updates.
  selectable: function(ct) {
    return !!ct.updatable && (ct.state == 'available' || dbu.view != 'available');
  },

  // Rows that took part in the current or last run stay visible whatever the
  // filter says, so their progress and result badges do not vanish mid-run.
  matches: function(ct) {
    if ((dbu.run && dbu.run.status[ct.name]) || (dbu.result && dbu.result.status[ct.name])) return true;
    if (dbu.view == 'available' && ct.state != 'available') return false;
    if (dbu.view == 'running' && !ct.running) return false;
    if (dbu.query) {
      return ct.name.toLowerCase().indexOf(dbu.query) >= 0 ||
             String(ct.image || '').toLowerCase().indexOf(dbu.query) >= 0;
    }
    return true;
  },

  visible: function() {
    return dbu.containers.filter(dbu.matches);
  },

  // Page order, not click order, so updates follow the Docker page order.
  selectedNames: function() {
    return dbu.containers.filter(function(ct) {
      return dbu.selected[ct.name] && dbu.selectable(ct);
    }).map(function(ct) { return ct.name; });
  },

  // The selection is always a subset of what the current view allows.
  prune: function() {
    var keep = {};
    dbu.containers.forEach(function(ct) {
      if (dbu.selected[ct.name] && dbu.selectable(ct)) keep[ct.name] = true;
    });
    dbu.selected = keep;
  },

  setView: function(view) {
    if (view != 'all' && view != 'running') view = 'available';
    dbu.view = view;
    try { localStorage.setItem('dbu-view', view); } catch (e) {}
    dbu.prune();
    dbu.lastClick = null;
    dbu.render();
  },

  toggle: function(name, on, shift, idx) {
    var rows = dbu.visible();
    if (shift && dbu.lastClick !== null && dbu.lastClick !== idx) {
      var a = Math.min(dbu.lastClick, idx), b = Math.max(dbu.lastClick, idx);
      for (var i = a; i <= b; i++) {
        var ct = rows[i];
        if (ct && dbu.selectable(ct)) {
          if (on) dbu.selected[ct.name] = true; else delete dbu.selected[ct.name];
        }
      }
    } else {
      if (on) dbu.selected[name] = true; else delete dbu.selected[name];
    }
    dbu.lastClick = idx;
    dbu.render();
  },

  relTime: function(s) {
    if (s < 60) return dbuText.justNow;
    if (s < 3600) return Math.floor(s / 60) + ' ' + dbuText.minAgo;
    if (s < 86400) return Math.floor(s / 3600) + ' ' + dbuText.hoursAgo;
    return Math.floor(s / 86400) + ' ' + dbuText.daysAgo;
  },

  /* ------------------------------------------------------------ rendering */

  render: function() {
    var rows = dbu.visible(), html = [], n = 0;
    rows.forEach(function(ct) {
      var sel = dbu.selectable(ct);
      var on = sel && !!dbu.selected[ct.name];
      n++;
      html.push(
        '<tr class="dbu-row' + (sel ? '' : ' dbu-disabled') + (on ? ' dbu-on' : '') + '" data-name="' + dbu.esc(ct.name) + '" data-i="' + (n - 1) + '">' +
        '<td class="dbu-check"><input type="checkbox" class="dbu-sel"' + (on ? ' checked' : '') + (sel && !dbu.run ? '' : ' disabled') + '></td>' +
        '<td class="dbu-order">' + n + '</td>' +
        '<td class="dbu-name">' + dbu.iconHtml(ct) + '<span class="dbu-name-text">' + dbu.esc(ct.name) + '</span>' +
          (ct.autostart ? '<i class="fa fa-play-circle-o dbu-auto" title="' + dbu.esc(dbuText.autostart) + '"></i>' : '') + '</td>' +
        '<td class="dbu-image">' + dbu.esc(ct.image) + '</td>' +
        '<td class="dbu-upd">' + dbu.updateCell(ct) + '</td>' +
        '<td class="dbu-state">' + dbu.stateCell(ct) + '</td>' +
        '<td class="dbu-digest">' + dbu.digestHtml(ct) + '</td>' +
        '</tr>'
      );
    });
    $('#dbu-list').html(html.join(''));
    $('#dbu-tablewrap').toggleClass('dbu-hidden', !rows.length);
    dbu.renderEmpty(rows);
    dbu.renderCards();
    dbu.renderChips();
    dbu.renderActions(rows);
  },

  iconHtml: function(ct) {
    if (!ct.icon) return '<span class="dbu-icon dbu-icon-empty"></span>';
    return '<img class="dbu-icon" src="' + dbu.esc(ct.icon) + '" alt="" onerror="this.style.visibility=\'hidden\'">';
  },

  digestHtml: function(ct) {
    if (!ct.local) return '';
    return dbu.esc(ct.local) + (ct.remote && ct.remote != ct.local ? ' <span class="dbu-arrow">&rarr;</span> ' + dbu.esc(ct.remote) : '');
  },

  updateCell: function(ct) {
    var st = (dbu.run && dbu.run.status[ct.name]) || (dbu.result && dbu.result.status[ct.name]);
    if (st) {
      var runMap = {
        queued:   ['neutral', 'fa-clock-o',            dbuText.queued],
        updating: ['info',    'fa-refresh fa-spin',    dbuText.updating],
        done:     ['ok',      'fa-check',              dbuText.done],
        failed:   ['bad',     'fa-exclamation-circle', dbuText.notUpdated]
      }[st];
      return dbu.badge(runMap[2], runMap[0], runMap[1]);
    }
    if (!ct.updatable) {
      return '<span class="dbu-muted">' + dbu.esc((dbuText.reasons || {})[ct.reason] || ct.reason) + '</span>';
    }
    var tone = {available: 'warn', current: 'ok', rebuild: 'warn', unknown: 'neutral'}[ct.state] || 'neutral';
    var icon = {available: 'fa-flash', current: 'fa-check', rebuild: 'fa-wrench', unknown: 'fa-question'}[ct.state] || '';
    return dbu.badge(dbuText[ct.state] || ct.state, tone, icon);
  },

  stateCell: function(ct) {
    var tone = ct.paused ? 'warn' : (ct.running ? 'ok' : 'neutral');
    var text = ct.paused ? dbuText.paused : (ct.running ? dbuText.running : dbuText.stopped);
    return '<span class="dbu-dot" data-tone="' + tone + '"></span>' + dbu.esc(text);
  },

  renderEmpty: function(rows) {
    var box = $('#dbu-empty');
    if (rows.length) { box.addClass('dbu-hidden'); return; }
    var icon, title, msg = '', action = '';
    if (!dbu.containers.length) {
      icon = 'fa-cubes'; title = dbuText.noContainers;
    } else if (dbu.query) {
      icon = 'fa-search'; title = dbuText.noMatch + ' “' + dbu.rawQuery + '”';
      action = '<a class="dbu-link" id="dbu-clearfilter">' + dbu.esc(dbuText.clearFilter) + '</a>';
    } else if (dbu.view == 'running') {
      icon = 'fa-power-off'; title = dbuText.noRunning;
    } else {
      icon = 'fa-check-circle'; title = dbuText.none; msg = dbuText.noneHint;
    }
    box.html(
      '<i class="fa ' + icon + '"></i>' +
      '<p class="dbu-empty-title">' + dbu.esc(title) + '</p>' +
      (msg ? '<p class="dbu-empty-msg">' + dbu.esc(msg) + '</p>' : '') +
      action
    ).removeClass('dbu-hidden');
  },

  card: function(id, value, tone, sub) {
    var el = $('#dbu-card-' + id).attr('data-tone', tone);
    el.find('.dbu-card-value').text(String(value));
    el.find('.dbu-card-sub').text(sub || '');
  },

  renderCards: function() {
    var total = dbu.containers.length;
    var avail = dbu.containers.filter(function(ct) { return ct.state == 'available'; }).length;
    var names = dbu.selectedNames();
    var hidden = names.filter(function(n) { return !dbu.matches(dbu.byName[n]); }).length;

    dbu.card('available', avail, avail ? 'warn' : 'ok', total + ' ' + dbuText.inTotal);
    dbu.card('selected', names.length, names.length ? 'info' : 'neutral',
      hidden ? hidden + ' ' + dbuText.hidden : (names.length ? dbuText.inOrder : dbuText.pickHint));

    if (dbu.checkedAt) {
      // Age from the server clock plus the time the page has been open.
      var age = (dbu.serverNow + Math.round((Date.now() - dbu.loadedAt) / 1000)) - dbu.checkedAt;
      var stale = age > 86400;
      dbu.card('checked', dbu.relTime(Math.max(0, age)), stale ? 'warn' : 'ok',
        (stale ? dbuText.stale + ' · ' : '') + new Date(dbu.checkedAt * 1000).toLocaleString());
    } else {
      dbu.card('checked', dbuText.never, 'warn', dbuText.runCheck);
    }

    if (dbu.run) {
      var done = dbu.run.names.filter(function(n) { return dbu.run.status[n] == 'done'; }).length;
      dbu.card('updater', dbuText.runningState, 'info', done + ' / ' + dbu.run.names.length + ' ' + dbuText.doneCount);
    } else if (dbu.checking) {
      dbu.card('updater', dbuText.checking, 'info', '');
    } else if (dbu.busy) {
      dbu.card('updater', dbuText.runningState, 'info', dbuText.startedElsewhere);
    } else {
      dbu.card('updater', dbuText.idle, 'ok', '');
    }
  },

  renderChips: function() {
    var counts = {available: 0, all: dbu.containers.length, running: 0};
    dbu.containers.forEach(function(ct) {
      if (ct.state == 'available') counts.available++;
      if (ct.running) counts.running++;
    });
    $('#dbu .dbu-chip').each(function() {
      var v = $(this).attr('data-view'), on = v == dbu.view;
      $(this).toggleClass('dbu-chip-on', on).attr('aria-pressed', on ? 'true' : 'false')
        .find('.dbu-chip-n').text(counts[v]);
    });
  },

  renderActions: function(rows) {
    var names = dbu.selectedNames();
    var pickable = rows.filter(dbu.selectable).length;
    var onShown = rows.filter(function(ct) { return dbu.selected[ct.name] && dbu.selectable(ct); }).length;
    var locked = !!dbu.run || dbu.busy || dbu.checking;
    $('#dbu-summary').text(names.length ? names.length + ' ' + dbuText.selected : dbuText.summaryNone);
    $('#dbu-clear').toggleClass('dbu-hidden', !names.length || !!dbu.run);
    $('#dbu-update').val(dbuText.updateSelected + (names.length ? ' (' + names.length + ')' : '')).prop('disabled', !names.length || locked);
    $('#dbu-check').prop('disabled', locked);
    $('#dbu-checkall').prop('checked', pickable > 0 && onShown == pickable).prop('disabled', !pickable || !!dbu.run);
    $('#dbu').toggleClass('dbu-locked', !!dbu.run);
  },

  renderResult: function() {
    var res = dbu.result, box = $('#dbu-result');
    if (!res) { box.addClass('dbu-hidden'); return; }
    var tone = res.failed.length ? (res.updated.length ? 'warn' : 'bad') : 'ok';
    var tags = res.updated.map(function(n) { return dbu.tag(n, 'ok', 'fa-check'); })
      .concat(res.failed.map(function(n) { return dbu.tag(n, 'bad', 'fa-times'); })).join(' ');
    box.attr('data-tone', tone).html(
      '<i class="fa ' + (tone == 'ok' ? 'fa-check-circle' : 'fa-exclamation-triangle') + ' dbu-result-icon"></i>' +
      '<div class="dbu-result-body">' +
        '<div class="dbu-result-title">' + dbu.esc(dbuText.resultTitle) + ': ' + res.updated.length + ' ' + dbu.esc(dbuText.resultUpdated) +
          (res.failed.length ? ', ' + res.failed.length + ' ' + dbu.esc(dbuText.resultNotUpdated) : '') + '</div>' +
        '<div class="dbu-result-list">' + tags + '</div>' +
        (res.failed.length ? '<div class="dbu-result-hint">' + dbu.esc(dbuText.resultHint) + '</div>' : '') +
      '</div>' +
      '<a class="dbu-link dbu-dismiss">' + dbu.esc(dbuText.dismiss) + '</a>'
    ).removeClass('dbu-hidden');
  },

  /* ------------------------------------------------------- stock updater */

  // Asks the stock command runner whether update_container is running. With
  // 'pid' set it only reports (pgrep), it never starts anything.
  checkBusy: function(cb) {
    $.post('/webGui/include/StartCommand.php', {cmd: 'update_container', pid: 1}, function(pid) {
      var p = String(pid == null ? '' : pid).trim();
      cb(p !== '' && p !== '0');
    }).fail(function() { cb(false); });
  },

  // Keeps the Updater card honest when "Update All" or a single update was
  // started from the Containers tab: a cheap pgrep every 15 s while idle,
  // every 5 s while something is running, nothing while our own run polls.
  watchBusy: function() {
    clearTimeout(dbu.busyTimer);
    dbu.checkBusy(function(busy) {
      if (dbu.run) return;
      var was = dbu.busy;
      dbu.busy = busy;
      if (was && !busy) dbu.load(); else if (was !== busy) dbu.render();
      dbu.busyTimer = setTimeout(dbu.watchBusy, busy ? 5000 : 15000);
    });
  },

  checkForUpdates: function() {
    if (dbu.run || dbu.checking) return;
    dbu.checking = true;
    dbu.render();
    // Same endpoint as the stock "Check for Updates" button; it takes no parameters.
    $.post('/plugins/dynamix.docker.manager/include/DockerUpdate.php', {}).always(function() {
      dbu.checking = false;
      dbu.load();
      if (typeof loadlist === 'function') loadlist();
    });
  },

  update: function() {
    var names = dbu.selectedNames();
    if (!names.length || dbu.run) return;
    var items = names.map(function(n) {
      return '<li data-name="' + dbu.esc(n) + '">' +
        '<i class="fa fa-bars dbu-grip"></i>' +
        '<span class="dbu-confirm-name">' + dbu.esc(n) + '</span>' +
        '<span class="dbu-confirm-mv">' +
          '<a class="dbu-mv dbu-mv-up" title="' + dbu.esc(dbuText.moveUp) + '"><i class="fa fa-chevron-up"></i></a>' +
          '<a class="dbu-mv dbu-mv-down" title="' + dbu.esc(dbuText.moveDown) + '"><i class="fa fa-chevron-down"></i></a>' +
        '</span></li>';
    }).join('');
    swal({
      title: dbuText.confirmTitle,
      text: '<div class="dbu-confirm-text">' + dbu.esc(dbuText.confirmText) + '</div><ol class="dbu-confirm">' + items + '</ol>',
      type: 'warning', html: true, showCancelButton: true, closeOnConfirm: false,
      confirmButtonText: dbuText.confirmButton, cancelButtonText: dbuText.cancel
    }, function() {
      // The list in the dialog is the order the user settled on.
      var order = $('.dbu-confirm li').map(function() { return $(this).attr('data-name'); }).get();
      dbu.start(order.length ? order : names);
    });
    // Drag to reorder when jQuery UI is on the page (the Docker page loads it);
    // the arrows work regardless.
    if ($.fn.sortable) {
      setTimeout(function() {
        $('.dbu-confirm').sortable({axis: 'y', containment: 'parent', handle: '.dbu-grip', tolerance: 'pointer'});
      }, 0);
    }
  },

  start: function(order) {
    // Refuse to start while the stock updater is already busy (Update All, single update, ...).
    dbu.checkBusy(function(busy) {
      if (busy) {
        swal({title: dbuText.progressTitle, text: dbuText.busy, type: 'error'});
        dbu.busy = true;
        dbu.render();
        dbu.watchBusy();
        return;
      }
      // Fresh snapshot of the container IDs right before starting, so a
      // container counts as updated only when Docker replaced it in this run.
      dbu.load(function() {
        var names = order.filter(function(n) { return dbu.byName[n] && dbu.byName[n].updatable; });
        if (!names.length) { if (swal.close) swal.close(); return; }
        var before = {}, status = {};
        names.forEach(function(n, i) {
          before[n] = dbu.byName[n].id;
          status[n] = i ? 'queued' : 'updating';
        });
        dbu.result = null;
        dbu.renderResult();
        dbu.run = {names: names, before: before, status: status, timer: null};
        dbu.render();
        // Same call as the stock "Update All" button: update_container takes a
        // '*' separated, URI-encoded list and processes it sequentially.
        openDocker('update_container ' + names.map(encodeURIComponent).join('*'), dbuText.progressTitle, '', 'dbuAfterUpdate');
        dbu.run.timer = setTimeout(dbu.poll, dbu.pollMs);
      });
    });
  },

  // A container is done once its ID changed. The first one not done is the one
  // in progress: the stock script works through the list in order. If the
  // script skips a container that failed, the marker lags until the run ends,
  // when everything still unchanged is reported as not updated.
  applyIds: function(r, byName) {
    r.names.forEach(function(n) {
      var ct = byName[n];
      if (ct && ct.id && ct.id !== r.before[n]) r.status[n] = 'done';
    });
    var seen = false;
    r.names.forEach(function(n) {
      if (r.status[n] == 'done') return;
      r.status[n] = seen ? 'queued' : 'updating';
      seen = true;
    });
  },

  poll: function() {
    var r = dbu.run;
    if (!r) return;
    clearTimeout(r.timer);
    $.getJSON(dbu.base + '/include/ContainerList.php', function(data) {
      if (dbu.run !== r) return;
      var byName = {};
      (data.containers || []).forEach(function(ct) { byName[ct.name] = ct; });
      dbu.applyIds(r, byName);
      dbu.checkBusy(function(busy) {
        if (dbu.run !== r) return;
        if (busy) {
          dbu.render();
          r.timer = setTimeout(dbu.poll, dbu.pollMs);
        } else {
          dbu.finish(r);
        }
      });
    }).fail(function() {
      if (dbu.run !== r) return;
      r.timer = setTimeout(dbu.poll, dbu.pollMs);
    });
  },

  finish: function(r) {
    clearTimeout(r.timer);
    // One last look: the final recreate can land between the list fetch and
    // the busy check that ended the run.
    $.getJSON(dbu.base + '/include/ContainerList.php').always(function(data) {
      if (dbu.run !== r) return;
      // If this last fetch failed, keep what the previous poll established.
      if (data && data.containers) {
        var byName = {};
        data.containers.forEach(function(ct) { byName[ct.name] = ct; });
        dbu.applyIds(r, byName);
      }
      var updated = [], failed = [];
      r.names.forEach(function(n) {
        if (r.status[n] == 'done') updated.push(n);
        else { r.status[n] = 'failed'; failed.push(n); }
      });
      dbu.run = null;
      dbu.busy = false;
      dbu.result = {status: r.status, updated: updated, failed: failed};
      dbu.selected = {};
      dbu.renderResult();
      dbu.load();
      dbu.watchBusy();
      if (typeof loadlist === 'function') loadlist();
    });
  }
};

// Called by the Unraid progress window (or, on 7.4+, the task tray) once the
// update run has finished. Must stay a global function: it is looked up by name.
function dbuAfterUpdate() {
  if (dbu.run) { dbu.poll(); return; }
  dbu.load();
  dbu.watchBusy();
  if (typeof loadlist === 'function') loadlist();
}

$(function() {
  var list = $('#dbu-list');

  list.on('click', 'input.dbu-sel', function(e) {
    var tr = $(this).closest('tr');
    dbu.toggle(tr.attr('data-name'), this.checked, e.shiftKey, parseInt(tr.attr('data-i'), 10));
  });
  list.on('click', 'tr.dbu-row:not(.dbu-disabled) td:not(.dbu-check)', function(e) {
    if (dbu.run) return;
    var tr = $(this).closest('tr'), name = tr.attr('data-name');
    dbu.toggle(name, !dbu.selected[name], e.shiftKey, parseInt(tr.attr('data-i'), 10));
  });
  // No text selection on shift-click ranges.
  list.on('mousedown', 'tr', function(e) { if (e.shiftKey) e.preventDefault(); });

  $('#dbu-checkall').on('change', function() {
    var on = this.checked;
    dbu.visible().forEach(function(ct) {
      if (!dbu.selectable(ct)) return;
      if (on) dbu.selected[ct.name] = true; else delete dbu.selected[ct.name];
    });
    dbu.render();
  });
  $('#dbu-clear').on('click', function() { dbu.selected = {}; dbu.render(); });
  $('#dbu .dbu-chips').on('click', '.dbu-chip', function() { dbu.setView($(this).attr('data-view')); });
  $('#dbu-search').on('input search', function() {
    dbu.rawQuery = this.value;
    dbu.query = $.trim(this.value).toLowerCase();
    dbu.lastClick = null;
    dbu.render();
  });
  $('#dbu-empty').on('click', '#dbu-clearfilter', function() { $('#dbu-search').val('').trigger('input'); });
  $('#dbu-result').on('click', '.dbu-dismiss', function() { dbu.result = null; dbu.renderResult(); dbu.render(); });
  $('#dbu-check').on('click', dbu.checkForUpdates);
  $('#dbu-update').on('click', dbu.update);

  // Arrows inside the confirmation dialog (it lives outside #dbu).
  $(document).on('click', '.dbu-confirm .dbu-mv', function(e) {
    e.preventDefault();
    var li = $(this).closest('li');
    if ($(this).hasClass('dbu-mv-up')) { if (li.prev().length) li.insertBefore(li.prev()); }
    else { if (li.next().length) li.insertAfter(li.next()); }
  });

  try { dbu.view = localStorage.getItem('dbu-view') || 'available'; } catch (e) {}
  if (dbu.view != 'all' && dbu.view != 'running') dbu.view = 'available';

  dbu.load();
  dbu.watchBusy();
  // Keep "Last check" ticking while the page stays open.
  setInterval(function() { if (!dbu.run) dbu.renderCards(); }, 60000);
});
