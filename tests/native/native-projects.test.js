import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const projectRoot = process.cwd();
const read = (relativePath) => readFileSync(path.join(projectRoot, relativePath));
const text = (relativePath) => read(relativePath).toString('utf8');

function pngDimensions(relativePath) {
  const contents = read(relativePath);
  assert.deepEqual(
    contents.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    `${relativePath} must be a PNG file`,
  );
  return { width: contents.readUInt32BE(16), height: contents.readUInt32BE(20) };
}

test('Capacitor production config bundles local assets and never points at a live-reload server', () => {
  const config = JSON.parse(text('capacitor.config.json'));

  assert.equal(config.appId, 'com.secureplan.surveyor');
  assert.equal(config.appName, 'SecurePlan Surveyor');
  assert.equal(config.webDir, 'dist');
  assert.equal(config.server?.androidScheme, 'https');
  assert.equal(config.server?.url, undefined);
  assert.equal(config.android?.allowMixedContent, false);
});

test('native projects declare required network and field-photo permissions', () => {
  const androidManifest = text('android/app/src/main/AndroidManifest.xml');
  const iosInfo = text('ios/App/App/Info.plist');

  assert.match(androidManifest, /android\.permission\.INTERNET/);
  assert.match(androidManifest, /android\.permission\.CAMERA/);
  assert.match(iosInfo, /NSCameraUsageDescription/);
  assert.match(iosInfo, /NSPhotoLibraryUsageDescription/);
  assert.match(iosInfo, /ITSAppUsesNonExemptEncryption/);
  assert.match(androidManifest, /android:allowBackup="false"/);
});

test('store projects use the SecurePlan 0.8.1 release version', () => {
  assert.match(text('android/app/build.gradle'), /versionCode 3/);
  assert.match(text('android/app/build.gradle'), /versionName "0\.8\.1"/);
  assert.match(text('ios/App/App.xcodeproj/project.pbxproj'), /CURRENT_PROJECT_VERSION = 3;/);
  assert.match(text('ios/App/App.xcodeproj/project.pbxproj'), /MARKETING_VERSION = 0\.8\.1;/);
});

test('native launcher and splash assets use expected platform dimensions and branding', () => {
  assert.deepEqual(
    pngDimensions('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'),
    { width: 1024, height: 1024 },
  );
  assert.deepEqual(
    pngDimensions('ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png'),
    { width: 2732, height: 2732 },
  );
  assert.deepEqual(
    pngDimensions('android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'),
    { width: 192, height: 192 },
  );

  const adaptiveIcon = text('android/app/src/main/res/drawable/ic_launcher_foreground.xml');
  const adaptiveBackground = text('android/app/src/main/res/values/ic_launcher_background.xml');
  assert.match(adaptiveIcon, /#B4232D/);
  assert.match(adaptiveIcon, /#FFFFFF/);
  assert.match(adaptiveBackground, /#101820/);
});
