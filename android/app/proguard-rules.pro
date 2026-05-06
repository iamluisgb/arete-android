-keep public class com.getcapacitor.** { *; }
-keep public class com.getcapacitor.plugin.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepclassmembers class * { @com.getcapacitor.annotation.PluginMethod *; }
-keepclassmembers class * { @com.getcapacitor.annotation.ActivityCallback *; }
-keepclassmembers class * { @com.getcapacitor.annotation.Callback *; }

# Google Sign-In plugin
-keep class io.capawesome.capacitorjs.plugins.googlesignin.** { *; }
-keep class com.google.android.gms.** { *; }
-keep class com.google.android.datatransport.** { *; }
-dontwarn com.google.android.gms.**

# Keep stack traces for debugging
-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*
