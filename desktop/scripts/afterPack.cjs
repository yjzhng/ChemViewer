// electron-builder afterPack hook: ad-hoc code-sign the packaged .app.
//
// We have no Apple Developer ID in this environment, so the app isn't notarized.
// But an arm64 app needs at least a VALID ad-hoc signature to launch (electron-
// builder's own signing is skipped via `identity: null`, which would otherwise
// leave the bundle seal broken: "code has no resources but signature indicates
// they must be present"). This re-seals the whole bundle ad-hoc so it runs.
//
// Users still see Gatekeeper's "unidentified developer" prompt on first open
// (right-click → Open, or `xattr -dr com.apple.quarantine ChemViewer.app`).

const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  console.log(`  • ad-hoc signing ${appName}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  })
  // Fail the build loudly if the seal is still invalid.
  execFileSync('codesign', ['--verify', '--strict', appPath], { stdio: 'inherit' })
}
