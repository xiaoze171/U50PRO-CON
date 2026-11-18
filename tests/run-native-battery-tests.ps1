param(
    [ValidateSet('factory', 'gauge88-csv')][string]$Profile = '',
    [string]$JsonJar = "$env:USERPROFILE/.gradle/caches/modules-2/files-2.1/org.json/json/20180813/8566b2b0391d9d4479ea225645c6ed47ef17fe41/json-20180813.jar",
    [string[]]$Tests = @('NativeBatteryProfileTest', 'NativeBatteryCsvTest', 'NativeBatteryCsvCacheTest', 'NativeBatteryFactoryTest', 'NativeBatteryGaugeTest', 'NativeBatteryCurrentWindowTest', 'NativeMonitorGaugeHistoryTest', 'NativeBatteryHistoryTest', 'MonitorSourceTest', 'MonitorTemperatureTest', 'NativeRouterAuthTest', 'NativeLocalBridgeTest', 'MonitorRuntimePolicyTest', 'NativeMonitorRequestLifecycleTest')
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$output = Join-Path $repository '.codex/apk-only-2026-11-17/jvm-classes'
$androidJar = Join-Path $repository '.android-sdk/platforms/android-30/android.jar'
$resourceJar = Join-Path $repository 'android-wrapper/app/build/intermediates/compile_and_runtime_not_namespaced_r_class_jar/debug/R.jar'
foreach ($dependency in @($JsonJar, $androidJar, $resourceJar)) {
    if (!(Test-Path -LiteralPath $dependency)) { throw "Missing existing test dependency: $dependency" }
}
New-Item -ItemType Directory -Force -Path $output | Out-Null
$classPath = "$JsonJar;$androidJar;$resourceJar"
$sources = @(Get-ChildItem -LiteralPath (Join-Path $repository 'android-wrapper/app/src/main/java/cn/mu5120/console') -Filter '*.java' | ForEach-Object FullName)
$sources += @(Get-ChildItem -LiteralPath (Join-Path $repository 'tests/java') -Filter '*.java' | ForEach-Object FullName)
$generatedConfig = Join-Path $output 'generated/BuildConfig.java'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $generatedConfig) | Out-Null
$profileFile = Join-Path $repository 'config/battery-profile.json'
$profileMode = if ($Profile) { $Profile } else { (Get-Content -Raw -LiteralPath $profileFile | ConvertFrom-Json).mode }
if ($profileMode -notin @('factory', 'gauge88-csv')) { throw 'Invalid battery profile' }
Set-Content -LiteralPath $generatedConfig -Encoding utf8 -Value "package cn.mu5120.console; public final class BuildConfig { public static final String BATTERY_PROFILE = `"$profileMode`"; public static final boolean DEBUG = true; public static final String VERSION_NAME = `"1.3.58`"; public static final int VERSION_CODE = 78; }"
$sources += $generatedConfig
& javac -encoding UTF-8 -source 8 -target 8 -cp $classPath -d $output @sources
if ($LASTEXITCODE -ne 0) { throw 'Native source/test compilation failed' }
foreach ($test in $Tests) {
    # org.json must precede android.jar: the SDK JSON classes are stubs.
    & java -cp "$output;$classPath" "cn.mu5120.console.$test" (Join-Path $repository 'tests/fixtures/battery-estimate-cases.json') $profileMode (Join-Path $repository 'tests/fixtures/battery-csv-cases.json')
    if ($LASTEXITCODE -ne 0) { throw "Native regression failed: $test" }
}
