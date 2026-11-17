param(
    [string]$JsonJar = "$env:USERPROFILE/.gradle/caches/modules-2/files-2.1/org.json/json/20180813/8566b2b0391d9d4479ea225645c6ed47ef17fe41/json-20180813.jar",
    [string[]]$Tests = @('NativeBatteryGaugeTest', 'NativeBatteryCurrentWindowTest', 'NativeMonitorGaugeHistoryTest', 'NativeBatteryHistoryTest', 'MonitorSourceTest', 'MonitorTemperatureTest', 'NativeSyncPublicationTest')
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$output = Join-Path $repository '.superpowers/sdd/2026-11-16-home-battery-estimate/jvm-classes'
$androidJar = Join-Path $repository '.android-sdk/platforms/android-30/android.jar'
$resourceJar = Join-Path $repository 'android-wrapper/app/build/intermediates/compile_and_runtime_not_namespaced_r_class_jar/debug/R.jar'
foreach ($dependency in @($JsonJar, $androidJar, $resourceJar)) {
    if (!(Test-Path -LiteralPath $dependency)) { throw "Missing existing test dependency: $dependency" }
}
New-Item -ItemType Directory -Force -Path $output | Out-Null
$classPath = "$JsonJar;$androidJar;$resourceJar"
$sources = @(Get-ChildItem -LiteralPath (Join-Path $repository 'android-wrapper/app/src/main/java/cn/mu5120/console') -Filter '*.java' | ForEach-Object FullName)
$sources += @(Get-ChildItem -LiteralPath (Join-Path $repository 'tests/java') -Filter '*.java' | ForEach-Object FullName)
$sources += Join-Path $repository 'android-wrapper/app/build/generated/source/buildConfig/debug/cn/mu5120/console/BuildConfig.java'
& javac -encoding UTF-8 -source 8 -target 8 -cp $classPath -d $output @sources
if ($LASTEXITCODE -ne 0) { throw 'Native source/test compilation failed' }
foreach ($test in $Tests) {
    # org.json must precede android.jar: the SDK JSON classes are stubs.
    & java -cp "$output;$classPath" "cn.mu5120.console.$test" (Join-Path $repository 'tests/fixtures/battery-estimate-cases.json')
    if ($LASTEXITCODE -ne 0) { throw "Native regression failed: $test" }
}
