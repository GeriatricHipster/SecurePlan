# SecurePlan Store Submission Checklist

SecurePlan's iOS and Android projects are configured under bundle/application ID `com.secureplan.surveyor`, version `0.7.0`, build `1`. The application code can be prepared here, but final signing and submission must be completed by the account owner because Apple and Google require private developer credentials and legal agreements.

## Blocking items before public review

- Add an in-app account-deletion flow and a public web deletion-request page. SecurePlan currently permits invited users to create accounts, so this is required by both stores.
- Publish a SecurePlan privacy policy at a permanent HTTPS URL and link to it inside the app.
- Choose a permanent support URL and support email.
- Create a dedicated reviewer account/invitation with sample data. Do not provide the owner account to reviewers.
- Test PDF upload, drawing, cloud photos, invitations, offline/reconnect behavior, and account deletion on physical iPhone, iPad, and Android devices.

## Apple App Store

1. Enroll in the Apple Developer Program using the person or organization that will own SecurePlan.
2. Install Xcode 26 or newer on a Mac. Starting April 28, 2026, Apple requires iPhone/iPad submissions to use the iOS 26 SDK or newer.
3. In App Store Connect, create an iOS app using bundle ID `com.secureplan.surveyor`.
4. Set `.env.native` to the production Render HTTPS URL and run `npm ci` followed by `npm run native:sync`.
5. Open `ios/App/App.xcworkspace` in Xcode, select the owner's signing team, and verify version `0.7.0`, build `1`.
6. Test on iPhone and iPad, then choose **Product > Archive > Distribute App > App Store Connect**.
7. In App Store Connect, complete the description, keywords, support URL, privacy-policy URL, screenshots, age rating, app privacy disclosures, encryption questions, accessibility information, and reviewer login.
8. Release to internal TestFlight first. After testing, attach the build to version `0.7.0` and submit it for App Review.

## Google Play

1. Create and verify a Google Play Console developer account. Choose Personal or Organization carefully; newly created Personal accounts have additional device-verification and testing requirements.
2. Create an app named **SecurePlan Surveyor** with application ID `com.secureplan.surveyor`.
3. Set `.env.native` to the production Render HTTPS URL and run `npm ci` followed by `npm run native:sync`.
4. Open the `android/` folder in Android Studio. Create and securely back up a release upload key; never add it or its passwords to Git.
5. Build a signed Android App Bundle (`.aab`). The project currently targets API 36.
6. Complete the store listing, privacy policy, Data safety form, account-deletion URL, ads declaration, target audience, content rating, app-access reviewer login, screenshots, icon, and feature graphic.
7. Upload the bundle to Internal testing first, test it on physical Android devices, then promote it through the required testing/production track.

## Draft store copy

**Name:** SecurePlan Surveyor

**Subtitle / short description:** Plot and collaborate on physical-security surveys from any device.

**Description:** SecurePlan Surveyor helps physical-security teams organize sites, upload floor-plan PDFs, plot access control, CCTV, intrusion, and door components, create reusable device assemblies, add notes and cloud photos, and collaborate in real time. Each survey maintains its own markup, device schedule, and editing history.

**Suggested category:** Productivity (primary), Business (secondary)

**Review notes:** SecurePlan requires authentication. Provide the reviewer with a dedicated invited editor account, a sample site, at least one sample PDF survey, and exact steps for accessing drawing, camera FOV, notes, and cloud-photo features.

## Release-number rule

Increase `versionCode` on Android and `CURRENT_PROJECT_VERSION` on iOS for every uploaded build, even when the public version remains the same. Never reuse a build number that has already reached either store.
