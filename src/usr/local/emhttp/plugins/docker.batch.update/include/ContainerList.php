<?PHP
/* Docker Batch Update - container list endpoint
 *
 * Returns JSON describing every container known to the Unraid Docker manager,
 * in the same order as the Docker Containers page, together with its update
 * state as recorded by the stock dockerMan update check.
 *
 * Read-only: this endpoint never changes anything. It is fetched with GET and
 * is protected by the normal webGUI login like every other plugin include.
 */
$docroot ??= ($_SERVER['DOCUMENT_ROOT'] ?: '/usr/local/emhttp');
require_once "$docroot/webGui/include/Helpers.php";
require_once "$docroot/plugins/dynamix.docker.manager/include/DockerClient.php";

header('Content-Type: application/json');

$DockerClient    = new DockerClient();
$DockerTemplates = new DockerTemplates();

$containers = $DockerClient->getDockerContainers();
$allInfo    = $DockerTemplates->getAllInfo();
$status     = DockerUtil::loadJSON($dockerManPaths['update-status']);

// Same ordering as the stock Docker Containers page (user drag & drop order).
if (is_file($dockerManPaths['user-prefs'])) {
  $prefs = (array)@parse_ini_file($dockerManPaths['user-prefs']);
  $sort = [];
  foreach ($containers as $ct) {
    $pos = array_search($ct['Name'], $prefs);
    $sort[] = $pos === false ? PHP_INT_MAX : $pos;
  }
  array_multisort($sort, SORT_NUMERIC, $containers);
}

function shortDigest($digest) {
  $digest = str_replace('sha256:', '', (string)$digest);
  return $digest ? substr($digest, 0, 12) : '';
}

$list = [];
foreach ($containers as $ct) {
  $name  = $ct['Name'];
  $image = $ct['Image'];
  $info  = $allInfo[$name] ?? [];
  $st    = $status[$image] ?? [];

  // Mirrors DockerContainers.php: 'true' = up to date, 'false' = update available,
  // anything else = unknown / not checkable.
  $updated = $info['updated'] ?? null;
  if (substr($ct['NetworkMode'] ?? '', -4) == ':???') {
    $state = 'rebuild';
  } elseif ($updated === 'false') {
    $state = 'available';
  } elseif ($updated === 'true') {
    $state = 'current';
  } else {
    $state = 'unknown';
  }

  // update_container can only handle containers that have a user template
  // (i.e. were created by the Unraid Docker manager, not compose etc).
  // 'reason' is a code; the page translates it for display.
  $manager   = $ct['Manager'] ?: 'unmanaged';
  $template  = $info['template'] ?? '';
  $updatable = $manager === 'dockerman' && !empty($template);
  $reason    = '';
  if ($manager === 'composeman') $reason = 'compose';
  elseif ($manager !== 'dockerman') $reason = 'unmanaged';
  elseif (empty($template)) $reason = 'notemplate';

  $list[] = [
    'name'      => $name,
    'image'     => $image,
    'icon'      => $info['icon'] ?? '',
    'running'   => (bool)$ct['Running'],
    'paused'    => (bool)$ct['Paused'],
    'autostart' => (bool)($info['autostart'] ?? false),
    'state'     => $state,
    'local'     => shortDigest($st['local'] ?? ''),
    'remote'    => shortDigest($st['remote'] ?? ''),
    'updatable' => $updatable,
    'reason'    => $reason,
  ];
}

// Never emit a half-written body: on an encoding problem (e.g. a stray byte in
// a container label) report it as an error instead of an empty response.
$json = json_encode(['containers' => $list], JSON_INVALID_UTF8_SUBSTITUTE);
if ($json === false) {
  http_response_code(500);
  $json = json_encode(['error' => json_last_error_msg()]);
}
echo $json;
