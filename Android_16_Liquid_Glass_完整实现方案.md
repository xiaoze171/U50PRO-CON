# Android 16 Liquid Glass 完整实现方案

## 1. 项目目标

目标是在 **Android 16** 上实现一套尽可能接近 Apple iOS 26 Liquid Glass 的 UI 材质效果。

注意：

- Apple 没有公开 Liquid Glass 的内部实现源码和完整参数，因此无法声称 100% 复刻内部实现。
- 本方案以 Apple 公开的视觉特征为目标：透明/半透明、背景模糊、折射、Lensing、Fresnel、Specular 高光、边缘光、动态色调、阴影、交互响应和 Morph。
- 由于目标设备固定为 Android 16，不为了旧版本兼容而牺牲效果。

Apple 官方公开资料：
- Liquid Glass 技术概览：https://developer.apple.com/documentation/technologyoverviews/liquid-glass
- WWDC Liquid Glass：https://developer.apple.com/videos/play/wwdc2025/102/
- Meet with Apple - Liquid Glass：https://developer.apple.com/videos/play/meet-with-apple/208/
- UIGlassContainerEffect：https://developer.apple.com/documentation/UIKit/UIGlassContainerEffect

Android 官方资料：
- Android 13 RuntimeShader / AGSL：https://developer.android.com/about/versions/13/features
- Android 16 新图形能力：https://developer.android.com/about/versions/16/features
- RenderNode：https://developer.android.com/reference/android/graphics/RenderNode
- RenderEffect：https://developer.android.com/reference/android/graphics/RenderEffect

---

# 2. 总体技术路线

采用：

```text
Kotlin
    +
Jetpack Compose
    +
RenderNode
    +
RenderEffect
    +
AGSL RuntimeShader
    +
RuntimeColorFilter
    +
RuntimeXfermode
```

总体渲染链：

```text
App Content
    │
    ▼
Background Capture
    │
    ▼
Shared Background Texture
    │
    ├───────────────┐
    ▼               ▼
   Blur        Color Analysis
    │               │
    └───────┬───────┘
            ▼
       Refraction
            │
            ▼
          Lens
            │
            ▼
         Fresnel
            │
            ▼
        Specular
            │
            ▼
      Edge Highlight
            │
            ▼
      Adaptive Tint
            │
            ▼
         Shadow
            │
            ▼
       Final Composite
```

---

# 3. 为什么不能只使用 Blur

普通 Glassmorphism：

```text
Background
    ↓
Gaussian Blur
    ↓
White Alpha
    ↓
Rounded Corner
```

Liquid Glass：

```text
Background
    ↓
Sampling
    ↓
Blur
    ↓
SDF Geometry
    ↓
Normal
    ↓
Refraction
    ↓
Lensing
    ↓
Fresnel
    ↓
Specular
    ↓
Adaptive Tint
    ↓
Edge Highlight
    ↓
Shadow
    ↓
GPU Composite
```

因此不能简单使用：

```kotlin
Modifier.blur(...)
```

作为最终方案。

---

# 4. 工程结构

推荐独立成一个 Liquid Glass UI Framework：

```text
LiquidGlass/
│
├── app/
│
└── liquidglass/
    │
    ├── LiquidGlass.kt
    ├── LiquidGlassContainer.kt
    ├── LiquidGlassStyle.kt
    ├── LiquidGlassState.kt
    │
    ├── capture/
    │   ├── BackgroundCapture.kt
    │   ├── GlassTexture.kt
    │   └── DownSampler.kt
    │
    ├── renderer/
    │   ├── GlassRenderer.kt
    │   ├── GlassRenderNode.kt
    │   ├── GlassRenderEffect.kt
    │   └── GlassCompositor.kt
    │
    ├── shader/
    │   ├── GlassShader.agsl
    │   ├── Refraction.agsl
    │   ├── Specular.agsl
    │   ├── Edge.agsl
    │   └── Composite.agsl
    │
    ├── geometry/
    │   ├── Sdf.kt
    │   ├── GlassShape.kt
    │   └── GlassPath.kt
    │
    └── animation/
        ├── GlassInteraction.kt
        ├── GlassMorph.kt
        └── GlassSpring.kt
```

---

# 5. 核心组件

最终公开 API：

```kotlin
@Composable
fun LiquidGlass(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(24.dp),
    style: LiquidGlassStyle = LiquidGlassStyle.Default,
    interaction: GlassInteraction = GlassInteraction.Default,
    content: @Composable BoxScope.() -> Unit
)
```

示例：

```kotlin
LiquidGlass(
    modifier = Modifier.size(100.dp),
    shape = RoundedCornerShape(30.dp),
    style = LiquidGlassStyle.Default
) {
    Icon(
        imageVector = Icons.Default.Search,
        contentDescription = null
    )
}
```

---

# 6. LiquidGlassStyle

不要把参数硬编码到 Shader。

建议：

```kotlin
data class LiquidGlassStyle(
    val blurRadius: Float = 18f,
    val refraction: Float = 0.18f,
    val lens: Float = 0.30f,
    val fresnel: Float = 0.55f,
    val specular: Float = 0.75f,
    val edgeLight: Float = 0.50f,
    val tintAlpha: Float = 0.08f,
    val saturation: Float = 1.05f,
    val contrast: Float = 1.04f,
    val thickness: Float = 0.20f,
    val shadowRadius: Float = 18f,
    val shadowAlpha: Float = 0.14f
) {
    companion object {
        val Default = LiquidGlassStyle()
    }
}
```

注意：这些数值不是 Apple 官方内部参数，只是 Android 第一版调参起点。

---

# 7. LiquidGlassContainer

这是整个方案的重要组件。

不要让每个 Glass 自己进行 Background Capture 和 Blur。

错误方案：

```text
Glass A → Capture → Blur
Glass B → Capture → Blur
Glass C → Capture → Blur
```

正确方案：

```text
LiquidGlassContainer
        │
        ▼
Background Capture
        │
        ▼
Shared Texture
        │
   ┌────┼────┐
   ▼    ▼    ▼
 Glass Glass Glass
   A     B     C
   └────┼────┘
        ▼
    Composite
```

API：

```kotlin
LiquidGlassContainer {

    LiquidGlass {
        Icon(Icons.Default.Home, null)
    }

    LiquidGlass {
        Icon(Icons.Default.Search, null)
    }

    LiquidGlass {
        Icon(Icons.Default.Person, null)
    }
}
```

这样可以：

- 减少重复 Blur
- 减少 Texture Capture
- 统一 Refraction
- 支持多个 Glass 的 Morph
- 降低 GPU 压力

Apple 也提供了 Glass Container 的设计，用于管理多个玻璃元素之间的组合和 Morph。

---

# 8. Background Capture

目标：

```text
App UI
   ↓
RenderNode
   ↓
Background Texture
   ↓
Glass Shader
```

Android 16 优先使用：

```text
RenderNode
+
Backdrop RenderEffect
```

RenderNode 支持 `setBackdropRenderEffect()`，适合处理节点背后的内容。

对于需要精细折射控制的 Glass，可以同时维护自定义 Texture Sampling 路径。

推荐：

```text
Glass Engine
      │
 ┌────┴────┐
 ▼         ▼
Backdrop   Texture
Path       Path
 │         │
 └────┬────┘
      ▼
Glass Shader
```

---

# 9. Downsampling

不要对完整屏幕分辨率直接做高成本 Blur。

例如：

```text
1080 × 2400
    ↓
540 × 1200
    ↓
Blur
    ↓
Shader
    ↓
Upscale
```

540 × 1200 只有原始像素数量的 25%。

推荐：

```text
High Quality:
0.75x

Balanced:
0.50x

Low:
0.35x
```

具体值需要通过 GPU Profiling 决定。

---

# 10. SDF 玻璃几何

不要只依赖普通 RoundedCornerShape。

Shader 使用 Signed Distance Field。

圆角矩形：

```glsl
float roundedRectSDF(
    float2 p,
    float2 halfSize,
    float radius
) {
    float2 q =
        abs(p) -
        halfSize +
        radius;

    return length(
        max(q, 0.0)
    )
    +
    min(
        max(q.x, q.y),
        0.0
    )
    -
    radius;
}
```

得到：

```text
distance < 0
    inside

distance = 0
    edge

distance > 0
    outside
```

SDF 后续用于：

- Shape Mask
- Edge
- Normal
- Fresnel
- Refraction
- Specular
- Shadow

---

# 11. Normal 计算

通过 SDF Gradient 获得表面法线。

```glsl
float2 calculateNormal(float2 p, float eps) {

    float dx =
        sdf(p + float2(eps, 0.0)) -
        sdf(p - float2(eps, 0.0));

    float dy =
        sdf(p + float2(0.0, eps)) -
        sdf(p - float2(0.0, eps));

    return normalize(
        float2(dx, dy)
    );
}
```

Normal 是整个光学效果的基础。

---

# 12. Refraction

普通 Blur：

```text
Background
    ↓
Blur
```

Liquid Glass：

```text
Background
    ↓
Blur
    ↓
Normal
    ↓
Refraction
    ↓
改变采样坐标
```

基本公式：

```glsl
float2 refractedUv =
    uv +
    normal *
    thickness *
    refraction;
```

推荐第一版：

```text
refraction = 0.18
thickness  = 0.20
```

之后通过视觉对比进行调参。

---

# 13. Lensing

Lensing 是 Liquid Glass 和普通毛玻璃区别非常明显的部分。

需要根据：

```text
SDF
+
Distance to Edge
+
Normal
+
Curvature
```

控制背景坐标偏移。

例如：

```glsl
float edgeFactor =
    1.0 -
    smoothstep(
        0.0,
        edgeWidth,
        abs(sdf)
    );

float2 lensOffset =
    normal *
    edgeFactor *
    lensStrength;
```

然后：

```glsl
float2 sampleUv =
    uv +
    lensOffset;
```

目标视觉：

```text
普通玻璃：

┌──────────────┐
│   背景模糊   │
└──────────────┘

Liquid Glass：

╭──────────────╮
│   背景内容   │
│  边缘产生折射 │
╰──────────────╯
```

---

# 14. Fresnel

使用 Fresnel 强化边缘。

```glsl
float fresnelTerm =
    pow(
        1.0 -
        dot(viewDir, normal),
        fresnelPower
    );
```

然后：

```glsl
color.rgb +=
    fresnelTerm *
    edgeLight;
```

效果：

```text
中心：
透明 / 柔和

边缘：
更亮 / 更有厚度 / 更像玻璃
```

---

# 15. Specular

Liquid Glass 的高光不是普通白色 Border。

模拟光源：

```glsl
float3 L =
    normalize(lightDirection);

float NdotL =
    max(
        dot(normal, L),
        0.0
    );

float spec =
    pow(
        NdotL,
        specularPower
    );
```

最终：

```glsl
color.rgb +=
    spec *
    specularIntensity;
```

建议参数：

```text
specular = 0.75
specularPower = 40 ~ 80
```

通过截图对比调整。

---

# 16. Edge Highlight

利用 SDF：

```glsl
float edge =
    1.0 -
    smoothstep(
        0.0,
        edgeWidth,
        abs(sdf)
    );
```

再结合：

```text
edge
+
Fresnel
+
Specular
```

生成玻璃边缘光。

不要简单：

```glsl
color += white;
```

否则会变成普通描边。

---

# 17. Adaptive Tint

不要固定：

```text
rgba(255,255,255,0.15)
```

先分析背景亮度。

```glsl
float luminance =
    dot(
        background.rgb,
        float3(
            0.2126,
            0.7152,
            0.0722
        )
    );
```

根据：

```text
Luminance
Saturation
Contrast
```

动态决定：

```text
Tint
Alpha
Brightness
Contrast
Saturation
```

建议逻辑：

```text
背景很亮
    ↓
玻璃适当降低亮度

背景很暗
    ↓
玻璃适当提高亮度

背景颜色很鲜艳
    ↓
适当降低局部颜色冲击

背景对比度很低
    ↓
增强 Glass Edge
```

---

# 18. RuntimeColorFilter

Android 16：

```text
Glass Shader
      ↓
RuntimeColorFilter
      ↓
Final Color
```

用于：

- Brightness
- Contrast
- Saturation
- Tint
- Adaptive Color

不要把所有颜色处理都堆到主 Shader。

---

# 19. RuntimeXfermode

最终：

```text
Background
    +
Glass
    +
Specular
    +
Reflection
    +
Edge
    ↓
RuntimeXfermode
    ↓
Final Composite
```

Android 16 新增 AGSL RuntimeXfermode，可以用于自定义源/目标像素合成。

这是 Android 16 方案的重要优势。

---

# 20. Shadow

Shadow 不应该只是：

```text
elevation = 8.dp
```

建议：

```text
Glass Shape
    ↓
SDF
    ↓
Expanded SDF
    ↓
Soft Shadow
```

参数：

```text
shadowRadius = 18
shadowAlpha  = 0.14
```

同时根据背景亮度动态调整。

---

# 21. 交互

按压时不要只有：

```text
scale(0.95)
```

应该同时变化：

```text
Scale
Refraction
Specular
Brightness
Shape
```

Normal：

```text
scale      = 1.00
refraction = 0.18
specular   = 0.70
```

Pressed：

```text
scale      = 0.97
refraction = 0.25
specular   = 1.00
```

释放使用 Spring。

---

# 22. Morph

例如：

```text
   ○
```

变成：

```text
╭──────────────╮
│     Menu     │
╰──────────────╯
```

不要：

```text
fadeOut
+
fadeIn
```

而是：

```text
Circle SDF
     ↓
Morph
     ↓
RoundedRect SDF
```

示例：

```glsl
float shape =
    mix(
        circleSdf,
        roundedRectSdf,
        morphProgress
    );
```

更高级版本使用 Smooth Union，使两个 Glass 元素产生液态融合效果。

---

# 23. Scroll

滚动时不要每帧：

```text
CPU Screenshot
↓
Bitmap
↓
Blur
```

推荐：

```text
Background Texture
       ↓
      固定
       ↓
Glass UV
       ↑
Scroll Offset
```

也就是说：

```text
Scroll
  ↓
改变 Shader Sampling UV
```

而不是重新生成整张背景图。

---

# 24. 性能策略

禁止：

```text
每个 Glass 一个 Bitmap
每个 Glass 一个 Blur
每帧 CPU 截屏
CPU Gaussian Blur
嵌套大量 Glass
滚动时重新创建 Shader
```

推荐：

```text
LiquidGlassContainer
        ↓
Shared Background
        ↓
Shared Blur
        ↓
Multiple Glass
```

性能档位：

### HIGH

```text
0.75x Background
Full Refraction
Full Lens
Specular
Fresnel
Adaptive Tint
Morph
```

### BALANCED

```text
0.50x Background
Refraction
Lens
Specular
Adaptive Tint
```

### LOW

```text
0.35x Background
Light Refraction
Reduced Blur
Reduced Specular
No complex Morph
```

---

# 25. 动态质量控制

根据 Frame Time 动态降低质量：

```text
60 FPS+
    ↓
HIGH

55 ~ 60 FPS
    ↓
BALANCED

45 ~ 55 FPS
    ↓
LOW

< 45 FPS
    ↓
Fallback Glass
```

不要为了 Liquid Glass 导致整个 App 掉帧。

优先保证：

```text
Frame Stability
>
Blur Quality
```

---

# 26. 推荐默认参数

第一版：

```text
blurRadius      = 18 px
refraction      = 0.18
lens            = 0.30
fresnel         = 0.55
specular        = 0.75
edgeLight       = 0.50
tintAlpha       = 0.08
saturation      = 1.05
contrast        = 1.04
thickness       = 0.20
shadowRadius    = 18 px
shadowAlpha     = 0.14
```

这些只是工程初始值，不代表 Apple 内部参数。

---

# 27. 推荐组件

最终可以提供：

```text
LiquidGlass
LiquidGlassContainer
LiquidGlassButton
LiquidGlassIconButton
LiquidGlassNavigationBar
LiquidGlassNavigationItem
LiquidGlassSearchBar
LiquidGlassSheet
LiquidGlassDialog
```

例如：

```kotlin
LiquidGlassContainer {

    LiquidGlassNavigationBar {

        LiquidGlassNavigationItem(
            selected = current == 0
        ) {
            Icon(
                Icons.Default.Home,
                null
            )
        }

        LiquidGlassNavigationItem(
            selected = current == 1
        ) {
            Icon(
                Icons.Default.Search,
                null
            )
        }

        LiquidGlassNavigationItem(
            selected = current == 2
        ) {
            Icon(
                Icons.Default.Person,
                null
            )
        }
    }
}
```

---

# 28. 底部导航栏目标效果

```text
┌────────────────────────────────────┐
│                                    │
│             App Content            │
│                                    │
│                                    │
│                                    │
│   ╭────────────────────────────╮   │
│   │   ◉       ○       ○       │   │
│   ╰────────────────────────────╯   │
└────────────────────────────────────┘
```

Glass Bar：

```text
Background Sampling
        +
Blur
        +
Refraction
        +
Lensing
        +
Fresnel
        +
Specular
        +
Adaptive Tint
        +
Shadow
```

---

# 29. 开发阶段

## V1：基础玻璃

实现：

```text
Background
+
Blur
+
Tint
+
Rounded Shape
```

目标：

> 看起来像玻璃。

---

## V2：Liquid

增加：

```text
Refraction
Lens
Fresnel
Specular
Edge Light
```

目标：

> 从普通 Glassmorphism 进入 Liquid Glass。

---

## V3：Apple 风格

增加：

```text
Adaptive Tint
Dynamic Shadow
Interaction
Press
Morph
```

目标：

> 视觉和交互接近 iOS 26。

---

## V4：Engine

增加：

```text
Container
Shared Texture
Downsampling
GPU Profiling
Dynamic Quality
120Hz Optimization
```

目标：

> 成为正式可复用的 Android Liquid Glass Framework。

---

# 30. 推荐开发顺序

严格按照：

```text
Phase 1
├── Glass Shape
├── Background Sampling
└── Blur

Phase 2
├── Refraction
├── Lens
└── Edge Highlight

Phase 3
├── Fresnel
├── Specular
├── Adaptive Tint
└── Shadow

Phase 4
├── Interaction
├── Press
└── Scroll

Phase 5
├── Container
├── Shared Texture
└── Morph

Phase 6
├── GPU Profiling
├── Downsampling
├── Dynamic Quality
└── 120Hz Optimization
```

---

# 31. 最终架构

```text
┌──────────────────────────────────────────────┐
│                  Android 16                  │
│                                              │
│              Jetpack Compose                │
│                     │                        │
│          ┌──────────▼──────────┐             │
│          │ LiquidGlassContainer│             │
│          └──────────┬──────────┘             │
│                     │                        │
│              Background Capture              │
│                     │                        │
│          ┌──────────▼──────────┐             │
│          │   Shared Texture    │             │
│          └──────────┬──────────┘             │
│                     │                        │
│                 AGSL Shader                  │
│                     │                        │
│       ┌─────────────┼─────────────┐          │
│       ▼             ▼             ▼          │
│     Blur        Refraction     SDF/Lens      │
│       │             │             │          │
│       └─────────────┼─────────────┘          │
│                     ▼                        │
│                  Fresnel                     │
│                     ▼                        │
│                  Specular                   │
│                     ▼                        │
│               Adaptive Tint                 │
│                     ▼                        │
│             RuntimeColorFilter              │
│                     ▼                        │
│              RuntimeXfermode                │
│                     ▼                        │
│                Final Glass                  │
└──────────────────────────────────────────────┘
```

---

# 32. 最终结论

对于固定 Android 16 设备，推荐采用：

> **Jetpack Compose + RenderNode/Backdrop + AGSL RuntimeShader + RuntimeColorFilter + RuntimeXfermode + Shared Background Texture + SDF + Refraction + Fresnel + Specular + Adaptive Tint + Morph**

而不是：

> BlurView + 半透明白色 + 圆角 + 阴影。

真正影响“像不像 iOS 26”的优先级：

```text
1. Background Sampling
2. Refraction / Lensing
3. Edge / Fresnel
4. Specular
5. Adaptive Tint
6. Blur
7. Shadow
8. Interaction
9. Morph
```

其中 **Refraction + Edge/Fresnel + Specular** 是从普通 Android 毛玻璃进入 Liquid Glass 的关键。

---

# 33. 第一阶段交付目标

第一版不要同时做整个框架。

先实现一个：

```text
LiquidGlassDemo
```

页面：

```text
┌──────────────────────────────┐
│                              │
│     彩色动态背景             │
│                              │
│        ╭────────────╮        │
│        │            │        │
│        │  Glass     │        │
│        │   Button   │        │
│        │            │        │
│        ╰────────────╯        │
│                              │
│     ╭──────────────────╮     │
│     │  Home Search User│     │
│     ╰──────────────────╯     │
│                              │
└──────────────────────────────┘
```

第一阶段只验证：

```text
实时背景
+
Blur
+
Refraction
+
Lens
+
Fresnel
+
Specular
+
Edge
```

验证通过后，再加入：

```text
Container
+
Morph
+
Interaction
+
Dynamic Quality
```

这样风险最低，也最容易通过 iOS 26 真机截图/录屏进行逐项视觉校准。
