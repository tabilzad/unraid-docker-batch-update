/* Docker Batch Update
 *
 * Everything lives in the dbu namespace because this page shares the DOM with
 * the stock Docker Containers tab (and its global docker.js functions).
 */
var dbu = {
  base: '/plugins/docker.batch.update',
  containers: [],
  selected: {},

  esc: function(s) {
    return $('<div>').text(s == null ? '' : String(s)).html();
  },

  load: function() {
    $.getJSON(dbu.base + '/include/ContainerList.php', function(data) {
      dbu.containers = data.containers || [];
      // Drop selections for containers that no longer need (or allow) an update.
      var keep = {};
      dbu.containers.forEach(function(ct) {
        if (dbu.selected[ct.name] && dbu.selectable(ct)) keep[ct.name] = true;
      });
      dbu.selected = keep;
      dbu.render();
    }).fail(function() {
      $('#dbu-list').html('<tr><td colspan="7" class="dbu-empty red-text">' + dbu.esc(dbuText.error) + '</td></tr>');
    });
  },

  showAll: function() {
    return $('#dbu-showall').prop('checked');
  },

  // A container can be picked when the stock updater can handle it, and either
  // it has an update available or the user chose to see everything (force update).
  selectable: function(ct) {
    return ct.updatable && (ct.state == 'available' || dbu.showAll());
  },

  visible: function() {
    var all = dbu.showAll();
    return dbu.containers.filter(function(ct) { return all || ct.state == 'available'; });
  },

  render: function() {
    var rows = dbu.visible(), html = [], n = 0;
    rows.forEach(function(ct) {
      var can = dbu.selectable(ct);
      var checked = can && dbu.selected[ct.name] ? ' checked' : '';
      var stateTxt = ct.paused ? dbuText.paused : (ct.running ? dbuText.running : dbuText.stopped);
      var stateCls = ct.paused ? 'dbu-paused' : (ct.running ? 'dbu-running' : 'dbu-stopped');
      var upd = ct.updatable ? (dbuText[ct.state] || ct.state) : ct.reason;
      var updCls = ct.updatable ? 'dbu-' + ct.state : 'dbu-unsupported';
      var digest = ct.local ? dbu.esc(ct.local) + (ct.remote && ct.remote != ct.local ? ' &rarr; ' + dbu.esc(ct.remote) : '') : '';
      var icon = ct.icon ? '<img class="dbu-icon" src="' + dbu.esc(ct.icon) + '" onerror="this.style.visibility=\'hidden\'">' : '';
      n++;
      html.push(
        '<tr class="' + (can ? '' : 'dbu-disabled') + '" data-name="' + dbu.esc(ct.name) + '">' +
        '<td class="dbu-check"><input type="checkbox" class="dbu-sel"' + checked + (can ? '' : ' disabled') + '></td>' +
        '<td class="dbu-order">' + n + '</td>' +
        '<td class="dbu-name">' + icon + dbu.esc(ct.name) + (ct.autostart ? ' <i class="fa fa-play-circle-o dbu-auto" title="Autostart"></i>' : '') + '</td>' +
        '<td class="dbu-image">' + dbu.esc(ct.image) + '</td>' +
        '<td class="' + updCls + '">' + dbu.esc(upd) + '</td>' +
        '<td class="' + stateCls + '">' + dbu.esc(stateTxt) + '</td>' +
        '<td class="dbu-digest">' + digest + '</td>' +
        '</tr>'
      );
    });
    if (!html.length) {
      var msg = dbu.containers.length ? dbuText.none : dbuText.noContainers;
      html.push('<tr><td colspan="7" class="dbu-empty">' + dbu.esc(msg) + '</td></tr>');
    }
    $('#dbu-list').html(html.join(''));
    dbu.refreshControls();
  },

  selectedNames: function() {
    // Keep page order, not click order, so updates follow the Docker page order.
    return dbu.visible().filter(function(ct) {
      return dbu.selectable(ct) && dbu.selected[ct.name];
    }).map(function(ct) { return ct.name; });
  },

  refreshControls: function() {
    var available = dbu.containers.filter(function(ct) { return ct.state == 'available'; }).length;
    var pickable = dbu.visible().filter(dbu.selectable).length;
    var names = dbu.selectedNames();
    $('#dbu-summary').text(available + ' ' + dbuText.summary + ' • ' + names.length + ' ' + dbuText.selected);
    $('#dbu-update').val(dbuText.updateSelected + (names.length ? ' (' + names.length + ')' : '')).prop('disabled', !names.length);
    $('#dbu-checkall').prop('checked', pickable > 0 && names.length == pickable).prop('disabled', !pickable);
  },

  checkForUpdates: function() {
    $('#dbu-check, #dbu-update').prop('disabled', true);
    $('#dbu-summary').html('<i class="fa fa-refresh fa-spin"></i> ' + dbu.esc(dbuText.checking) + '...');
    $.post('/plugins/dynamix.docker.manager/include/DockerUpdate.php', {}).always(function() {
      $('#dbu-check').prop('disabled', false);
      dbu.load();
      if (typeof loadlist === 'function') loadlist();
    });
  },

  update: function() {
    var names = dbu.selectedNames();
    if (!names.length) return;
    var list = '<ol class="dbu-confirm">' + names.map(function(n) { return '<li>' + dbu.esc(n) + '</li>'; }).join('') + '</ol>';
    swal({
      title: dbuText.confirmTitle,
      text: dbuText.confirmText + ':' + list,
      type: 'warning', html: true, showCancelButton: true, closeOnConfirm: false,
      confirmButtonText: dbuText.confirmButton, cancelButtonText: dbuText.cancel
    }, function() {
      // Refuse to start while the stock updater is already busy (Update All, single update, ...).
      $.post('/webGui/include/StartCommand.php', {cmd: 'update_container', pid: 1}, function(pid) {
        if (pid && pid != 0) {
          swal({title: dbuText.progressTitle, text: dbuText.busy, type: 'error'});
          return;
        }
        $('#dbu-check, #dbu-update').prop('disabled', true);
        // update_container takes a '*' separated, URI-encoded list and processes it sequentially.
        var arg = names.map(encodeURIComponent).join('*');
        openDocker('update_container ' + arg, dbuText.progressTitle, '', 'dbuAfterUpdate');
      });
    });
  }
};

// Called by the Unraid progress window once the update run has finished and been closed.
function dbuAfterUpdate() {
  dbu.selected = {};
  $('#dbu-check').prop('disabled', false);
  dbu.load();
  if (typeof loadlist === 'function') loadlist();
}

$(function() {
  $('#dbu-list').on('change', 'input.dbu-sel', function() {
    var name = $(this).closest('tr').data('name');
    if (this.checked) dbu.selected[name] = true; else delete dbu.selected[name];
    dbu.refreshControls();
  });
  $('#dbu-list').on('click', 'tr:not(.dbu-disabled) td:not(.dbu-check)', function() {
    $(this).closest('tr').find('input.dbu-sel').trigger('click');
  });
  $('#dbu-checkall').on('change', function() {
    var on = this.checked;
    dbu.visible().filter(dbu.selectable).forEach(function(ct) {
      if (on) dbu.selected[ct.name] = true; else delete dbu.selected[ct.name];
    });
    dbu.render();
  });
  $('#dbu-showall').on('change', function() {
    try { localStorage.setItem('dbu-showall', this.checked ? '1' : '0'); } catch (e) {}
    if (!this.checked) dbu.load(); else dbu.render();
  });
  $('#dbu-check').on('click', dbu.checkForUpdates);
  $('#dbu-update').on('click', dbu.update);
  try { $('#dbu-showall').prop('checked', localStorage.getItem('dbu-showall') == '1'); } catch (e) {}
  dbu.load();
});
