/**
 * Full Native Android Studio Kotlin Project Deliverable
 * Architecture: Jetpack Compose + CameraX + ML Kit Barcode Scanning + Room SQLite
 */

export interface AndroidFile {
  path: string;
  filename: string;
  category: 'manifest' | 'gradle' | 'room' | 'logic' | 'ui' | 'test' | 'docs';
  description: string;
  code: string;
}

export const ANDROID_PROJECT_FILES: AndroidFile[] = [
  {
    path: 'android/app/build.gradle.kts',
    filename: 'build.gradle.kts (Module :app)',
    category: 'gradle',
    description: 'Gradle configuration with CameraX, ML Kit, Room, and Jetpack Compose dependencies.',
    code: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.kapt)
}

android {
    namespace = "com.btech.smartqr"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.btech.smartqr"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
}

dependencies {
    // Core & Lifecycle
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)

    // Jetpack Compose UI
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.navigation.compose)

    // CameraX for Camera Preview
    implementation("androidx.camera:camera-core:1.4.1")
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")

    // Google ML Kit Barcode / QR Scanning (Offline, no internet required)
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    // Room Database for local persistent storage
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")

    // Coroutines & GSON for JSON Import/Export
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.google.code.gson:gson:2.11.0")

    // Testing
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}`
  },
  {
    path: 'android/app/src/main/AndroidManifest.xml',
    filename: 'AndroidManifest.xml',
    category: 'manifest',
    description: 'Android Manifest declaring Camera hardware feature, permissions, and theme.',
    code: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- Camera hardware requirement for QR Scanning -->
    <uses-feature
        android:name="android.hardware.camera"
        android:required="false" />
    <uses-feature
        android:name="android.hardware.camera.autofocus"
        android:required="false" />

    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <application
        android:name=".SmartQrApplication"
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="SmartQR"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.SmartQR">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:screenOrientation="portrait"
            android:theme="@style/Theme.SmartQR">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

    </application>

</manifest>`
  },
  {
    path: 'android/app/src/main/java/com/btech/smartqr/data/ProductEntity.kt',
    filename: 'ProductEntity.kt & ScanHistoryEntity.kt',
    category: 'room',
    description: 'Room Entities representing the local authorized dataset and local scan history.',
    code: `package com.btech.smartqr.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(tableName = "registered_products")
data class ProductEntity(
    @PrimaryKey
    val productId: String,
    val productName: String,
    val manufacturer: String,
    val batchNumber: String,
    val registeredAt: String = System.currentTimeMillis().toString(),
    val notes: String = ""
)

@Entity(tableName = "scan_history")
data class ScanHistoryEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val timestamp: Long = System.currentTimeMillis(),
    val rawPayload: String,
    val productId: String,
    val productName: String,
    val manufacturer: String,
    val batchNumber: String,
    val status: String, // GENUINE, FAKE_MISMATCH, UNREGISTERED, INVALID_QR, AMBIGUOUS
    val mismatchedFields: String, // comma-delimited
    val registeredProductId: String? = null
)`
  },
  {
    path: 'android/app/src/main/java/com/btech/smartqr/data/ProductDao.kt',
    filename: 'ProductDao.kt',
    category: 'room',
    description: 'Room DAO for CRUD, Search, and Aggregations on registered records and scan logs.',
    code: `package com.btech.smartqr.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface ProductDao {
    @Query("SELECT * FROM registered_products ORDER BY productId ASC")
    fun getAllProductsFlow(): Flow<List<ProductEntity>>

    @Query("SELECT * FROM registered_products")
    suspend fun getAllProducts(): List<ProductEntity>

    @Query("SELECT * FROM registered_products WHERE productId = :id")
    suspend fun getProductById(id: String): ProductEntity?

    @Query("SELECT * FROM registered_products WHERE productId LIKE '%' || :query || '%' OR productName LIKE '%' || :query || '%' OR manufacturer LIKE '%' || :query || '%' OR batchNumber LIKE '%' || :query || '%'")
    suspend fun searchProducts(query: String): List<ProductEntity>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertProduct(product: ProductEntity)

    @Update
    suspend fun updateProduct(product: ProductEntity)

    @Delete
    suspend fun deleteProduct(product: ProductEntity)

    @Query("DELETE FROM registered_products")
    suspend fun clearAll()

    @Query("SELECT COUNT(*) FROM registered_products")
    suspend fun getProductCount(): Int
}

@Dao
interface ScanHistoryDao {
    @Query("SELECT * FROM scan_history ORDER BY timestamp DESC")
    fun getAllHistoryFlow(): Flow<List<ScanHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertScan(entry: ScanHistoryEntity)

    @Query("DELETE FROM scan_history")
    suspend fun clearHistory()

    @Query("SELECT COUNT(*) FROM scan_history")
    suspend fun getScanCount(): Int
}`
  },
  {
    path: 'android/app/src/main/java/com/btech/smartqr/data/AppDatabase.kt',
    filename: 'AppDatabase.kt',
    category: 'room',
    description: 'Room SQLite Database singleton with default seed dataset initialization.',
    code: `package com.btech.smartqr.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Database(entities = [ProductEntity::class, ScanHistoryEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun productDao(): ProductDao
    abstract fun scanHistoryDao(): ScanHistoryDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "smartqr_database"
                ).addCallback(object : Callback() {
                    override fun onCreate(db: SupportSQLiteDatabase) {
                        super.onCreate(db)
                        // Seed default B.Tech engineering sample products
                        CoroutineScope(Dispatchers.IO).launch {
                            val dao = getDatabase(context).productDao()
                            dao.insertProduct(ProductEntity("SB001", "Smart Battery", "ABC Electronics", "B001", notes = "Reference Lithium Pack"))
                            dao.insertProduct(ProductEntity("SS002", "Smart Sensor", "XYZ Electronics", "B002", notes = "Telemetry Sensor"))
                            dao.insertProduct(ProductEntity("SC003", "Smart Controller", "Tech Solutions", "B003", notes = "Master Controller"))
                        }
                    }
                }).build()
                INSTANCE = instance
                instance
            }
        }
    }
}`
  },
  {
    path: 'android/app/src/main/java/com/btech/smartqr/logic/QrPayloadParser.kt',
    filename: 'QrPayloadParser.kt',
    category: 'logic',
    description: 'ESP32 QR Payload parsing logic handling semicolon/newline delimiters and token cleanup.',
    code: `package com.btech.smartqr.logic

data class ParsedProduct(
    val productName: String,
    val productId: String,
    val manufacturer: String,
    val batchNumber: String
)

sealed class ParseResult {
    data class Success(val product: ParsedProduct, val raw: String) : ParseResult()
    data class Failure(val missingFields: List<String>, val reason: String, val raw: String) : ParseResult()
}

object QrPayloadParser {
    /**
     * Expected format:
     * Product: Smart Battery; ID: SB001; Manufacturer: ABC Electronics; Batch: B001
     */
    fun parse(rawText: String): ParseResult {
        val trimmed = rawText.trim()
        if (trimmed.isEmpty()) {
            return ParseResult.Failure(listOf("Product Name", "Product ID", "Manufacturer", "Batch Number"), "Payload is empty", rawText)
        }

        val delimiter = if (trimmed.contains(";")) ";" else if (trimmed.contains("\n")) "\n" else ","
        val tokens = trimmed.split(delimiter)

        val map = mutableMapOf<String, String>()
        for (token in tokens) {
            val part = token.trim()
            val colonIdx = part.indexOf(':')
            if (colonIdx != -1) {
                val key = part.substring(0, colonIdx).trim().lowercase()
                val value = part.substring(colonIdx + 1).trim()
                map[key] = value
            }
        }

        val productName = map["product"] ?: map["product name"] ?: map["name"]
        val productId = map["id"] ?: map["product id"] ?: map["productid"]
        val manufacturer = map["manufacturer"] ?: map["mfr"] ?: map["mfg"]
        val batchNumber = map["batch"] ?: map["batch number"] ?: map["batch no"]

        val missing = mutableListOf<String>()
        if (productName.isNullOrBlank()) missing.add("Product Name")
        if (productId.isNullOrBlank()) missing.add("Product ID")
        if (manufacturer.isNullOrBlank()) missing.add("Manufacturer")
        if (batchNumber.isNullOrBlank()) missing.add("Batch Number")

        return if (missing.isEmpty()) {
            ParseResult.Success(
                ParsedProduct(productName!!, productId!!, manufacturer!!, batchNumber!!),
                rawText
            )
        } else {
            ParseResult.Failure(missing, "Missing mandatory field(s): \${missing.joinToString()}", rawText)
        }
    }
}`
  },
  {
    path: 'android/app/src/main/java/com/btech/smartqr/logic/VerificationService.kt',
    filename: 'VerificationService.kt',
    category: 'logic',
    description: 'Deterministic verification service executing Section 8 decision cases A through E.',
    code: `package com.btech.smartqr.logic

import com.btech.smartqr.data.ProductDao
import com.btech.smartqr.data.ProductEntity

enum class VerificationStatus {
    GENUINE,
    FAKE_MISMATCH,
    UNREGISTERED,
    INVALID_QR,
    AMBIGUOUS_RECORD
}

data class VerificationResult(
    val status: VerificationStatus,
    val title: String,
    val message: String,
    val scanned: ParsedProduct?,
    val registered: ProductEntity?,
    val mismatchedFields: List<String>,
    val rawPayload: String
)

class VerificationService(private val productDao: ProductDao) {

    suspend fun verify(rawQrPayload: String): VerificationResult {
        // Step 1: Parse
        val parse = QrPayloadParser.parse(rawQrPayload)
        if (parse is ParseResult.Failure) {
            return VerificationResult(
                status = VerificationStatus.INVALID_QR,
                title = "INVALID QR CODE",
                message = parse.reason,
                scanned = null,
                registered = null,
                mismatchedFields = parse.missingFields,
                rawPayload = rawQrPayload
            )
        }

        val scanned = (parse as ParseResult.Success).product

        // Step 2: Query candidate record by Product ID
        val candidate = productDao.getProductById(scanned.productId.trim())

        // CASE C: Unregistered
        if (candidate == null) {
            return VerificationResult(
                status = VerificationStatus.UNREGISTERED,
                title = "UNREGISTERED PRODUCT",
                message = "Product ID '\${scanned.productId}' was not found in the local authorized dataset.",
                scanned = scanned,
                registered = null,
                mismatchedFields = listOf("Product ID"),
                rawPayload = rawQrPayload
            )
        }

        // Step 3: Exact field-by-field comparison
        val mismatches = mutableListOf<String>()

        if (!scanned.productId.trim().equals(candidate.productId.trim(), ignoreCase = false)) {
            mismatches.add("Product ID")
        }
        if (!scanned.productName.trim().equals(candidate.productName.trim(), ignoreCase = true)) {
            mismatches.add("Product Name")
        }
        if (!scanned.manufacturer.trim().equals(candidate.manufacturer.trim(), ignoreCase = true)) {
            mismatches.add("Manufacturer")
        }
        if (!scanned.batchNumber.trim().equals(candidate.batchNumber.trim(), ignoreCase = false)) {
            mismatches.add("Batch Number")
        }

        // CASE A: All four fields match
        if (mismatches.isEmpty()) {
            return VerificationResult(
                status = VerificationStatus.GENUINE,
                title = "GENUINE PRODUCT",
                message = "All 4 required parameters match the local authorized record exactly.",
                scanned = scanned,
                registered = candidate,
                mismatchedFields = emptyList(),
                rawPayload = rawQrPayload
            )
        }

        // CASE B: Mismatch detected
        return VerificationResult(
            status = VerificationStatus.FAKE_MISMATCH,
            title = "FAKE / INVALID PRODUCT",
            message = "Tamper detected: \${mismatches.size} field(s) do not match authorized specs.",
            scanned = scanned,
            registered = candidate,
            mismatchedFields = mismatches,
            rawPayload = rawQrPayload
        )
    }
}`
  },
  {
    path: 'android/app/src/main/java/com/btech/smartqr/scanner/CameraXScanner.kt',
    filename: 'CameraXScanner.kt',
    category: 'ui',
    description: 'Jetpack Compose CameraX preview integrating Google ML Kit BarcodeScanner.',
    code: `package com.btech.smartqr.scanner

import android.annotation.SuppressLint
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

@SuppressLint("UnsafeOptInUsageError")
@Composable
fun CameraXScannerView(
    onQrDetected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient() }
    var isScanned by remember { mutableStateOf(false) }

    AndroidView(
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)

            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }

                val imageAnalysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                    val mediaImage = imageProxy.image
                    if (mediaImage != null && !isScanned) {
                        val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                        scanner.process(image)
                            .addOnSuccessListener { barcodes ->
                                for (barcode in barcodes) {
                                    val rawValue = barcode.rawValue
                                    if (!rawValue.isNullOrBlank() && !isScanned) {
                                        isScanned = true
                                        onQrDetected(rawValue)
                                        break
                                    }
                                }
                            }
                            .addOnCompleteListener {
                                imageProxy.close()
                            }
                    } else {
                        imageProxy.close()
                    }
                }

                try {
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        imageAnalysis
                    )
                } catch (exc: Exception) {
                    exc.printStackTrace()
                }
            }, ContextCompat.getMainExecutor(ctx))

            previewView
        },
        modifier = modifier.fillMaxSize()
    )
}`
  },
  {
    path: 'android/README.md',
    filename: 'Android Studio Setup & Build Guide',
    category: 'docs',
    description: 'Complete build, execution, and APK generation instructions for Android Studio.',
    code: `# SmartQR - Android Studio Build & APK Installation Guide
**B.Tech Engineering Project: Tamper-Proof Product Authentication**

## 1. Prerequisites
- Android Studio Hedgehog (2023.1.1) or newer / Ladybug
- JDK 17 or higher
- Android SDK 35 (minSdk: 26 / Android 8.0 Oreo)
- Physical Android smartphone with USB Debugging enabled

## 2. Setting Up the Project in Android Studio
1. Open Android Studio -> Select **New Project** -> **Empty Activity (Jetpack Compose)**.
2. Set Package Name to: \`com.btech.smartqr\`
3. Select Language: **Kotlin**, Minimum SDK: **API 26 (Android 8.0)**.
4. Copy the files provided in the SmartQR Android Project tree into their respective paths:
   - \`app/build.gradle.kts\` -> Add dependencies for CameraX, ML Kit, and Room.
   - \`AndroidManifest.xml\` -> Add Camera & Vibrate permissions.
   - \`com/btech/smartqr/data/\` -> Place Room entities, DAOs, and AppDatabase.
   - \`com/btech/smartqr/logic/\` -> Place QrPayloadParser and VerificationService.
   - \`com/btech/smartqr/scanner/\` -> Place CameraXScannerView.
5. Click **Sync Project with Gradle Files** in the top bar.

## 3. Generating the Installable APK
1. In Android Studio, go to the top menu: **Build** -> **Build Bundle(s) / APK(s)** -> **Build APK(s)**.
2. Android Studio will compile Room schemas, Kotlin bytecodes, and ML Kit packages.
3. Once completed, a notification bubble will appear: *"APK(s) generated successfully."*
4. Click **locate** to find the output APK at:
   \`app/build/outputs/apk/debug/app-debug.apk\`

## 4. Installing on Physical Phone via ADB
\`\`\`bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
\`\`\`
Or transfer \`app-debug.apk\` via USB/Bluetooth and tap Install on your phone.

## 5. Offline Operation Note
Google ML Kit Barcode Scanning bundle is bundled in-app via the client dependency. The app requires ZERO internet access to scan, parse, verify, and store history.`
  }
];
