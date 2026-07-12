const { withAndroidManifest, withGradleProperties } = require('@expo/config-plugins');

function withAndroidNotificationListener(config) {
  // 1. Apply AndroidManifest modifications
  config = withAndroidManifest(config, async (config) => {
    let androidManifest = config.modResults;
    let mainApplication = androidManifest.manifest.application[0];
    
    if (!mainApplication.$) {
      mainApplication.$ = {};
    }
    mainApplication.$['tools:replace'] = mainApplication.$['tools:replace']
      ? `${mainApplication.$['tools:replace']},android:allowBackup`
      : 'android:allowBackup';

    if (!mainApplication.service) {
      mainApplication.service = [];
    }

    const serviceName = 'com.lesimoes.androidnotificationlistener.RNAndroidNotificationListener';
    let service = mainApplication.service.find(
      (s) => s.$ && s.$['android:name'] === serviceName
    );

    if (!service) {
      service = {
        $: {
          'android:name': serviceName,
          'android:label': 'RNAndroidNotificationListener',
          'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.service.notification.NotificationListenerService',
                },
              },
            ],
          },
        ],
      };
      mainApplication.service.push(service);
    }

    // Always set stopWithTask to false to ensure the service isn't killed when the app is swiped away
    service.$['android:stopWithTask'] = 'false';

    return config;
  });

  // 2. Apply gradle.properties modifications
  config = withGradleProperties(config, (config) => {
    const properties = config.modResults;

    // Reduce JVM heap size to prevent out-of-memory crashes on low-RAM systems
    const jvmArgs = properties.find((p) => p.key === 'org.gradle.jvmargs');
    if (jvmArgs) {
      jvmArgs.value = '-Xmx2048m -XX:MaxMetaspaceSize=512m';
    } else {
      properties.push({
        type: 'property',
        key: 'org.gradle.jvmargs',
        value: '-Xmx2048m -XX:MaxMetaspaceSize=512m',
      });
    }

    // Restrict the number of concurrent worker threads
    const maxWorkers = properties.find((p) => p.key === 'org.gradle.workers.max');
    if (maxWorkers) {
      maxWorkers.value = '2';
    } else {
      properties.push({
        type: 'property',
        key: 'org.gradle.workers.max',
        value: '2',
      });
    }

    return config;
  });

  return config;
}

module.exports = withAndroidNotificationListener;
