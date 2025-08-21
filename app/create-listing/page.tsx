"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth, db, storage } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { FiHome, FiSave, FiCamera, FiDollarSign, FiPackage, FiPlus, FiMinus, FiX, FiCheck, FiAlertCircle, FiUpload, FiSearch, FiStar, FiTrendingUp } from "react-icons/fi";
import Link from "next/link";
import Head from "next/head";
import axios from "axios";

// Import hooks ve utilities
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import { smartOptimizeImage, formatFileSize } from "@/utils/imageOptimization";
import { AmazonProduct, PricingResult } from "@/lib/pricingEngine";

interface BundleItem {
  id: string;
  isbn: string;
  condition: "like-new" | "good";
  quantity: number;
  price: number;
  image: string | null;
  imageBlob: Blob | null;
  imageStats?: any;
  category: "book" | "cd" | "dvd" | "game" | "mix";
  // Yeni Amazon verileri
  amazonData?: AmazonProduct;
  ourPrice?: number;
  originalPrice?: number;
}

export default function CreateListingPage() {
  const [user, loading] = useAuthState(auth);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Mevcut ürün formu için state
  const [currentItem, setCurrentItem] = useState<BundleItem>({
    id: "",
    isbn: "",
    condition: "like-new",
    quantity: 1,
    price: 0,
    image: null,
    imageBlob: null,
    category: "book"
  });
  
  // Eklenen ürünler listesi
  const [bundleItems, setBundleItems] = useState<BundleItem[]>([]);
  
  // Mevcut state'ler
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [imageProcessing, setImageProcessing] = useState(false);
  const [isPrivateMode, setIsPrivateMode] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  
  // Yeni Amazon ve scanner state'leri
  const [showScanner, setShowScanner] = useState(false);
  const [isCheckingAmazon, setIsCheckingAmazon] = useState(false);
  const [amazonResult, setAmazonResult] = useState<{
    product: AmazonProduct;
    pricing: PricingResult;
    message: string;
  } | null>(null);
  const [scannerError, setScannerError] = useState("");
  
  // Kullanıcıya özel depolama anahtarı
  const getStorageKey = useCallback(() => {
    return user ? `bundleListingDraft_${user.uid}` : 'bundleListingDraft_guest';
  }, [user]);
  
  // Barcode scanner hook
  const {
    isScanning,
    isCameraReady,
    error: cameraError,
    startScanning,
    stopScanning,
    videoRef,
    isMobile
  } = useBarcodeScanner({
    onScan: handleBarcodeScanned,
    onError: (error) => setScannerError(error),
    continuous: false,
    timeout: 30000
  });
  
  // Barcode tarandığında çağrılan fonksiyon
  async function handleBarcodeScanned(code: string) {
    console.log('📱 Barcode tarandı:', code);
    
    try {
      setIsCheckingAmazon(true);
      setError("");
      setAmazonResult(null);
      setScannerError("");
      
      // Scanner'ı kapat
      stopScanning();
      setShowScanner(false);
      
      // Amazon API'sine istek at
      const response = await axios.post('/api/amazon-check', {
        isbn_upc: code
      });
      
      if (response.data.success) {
        const { product, pricing, message } = response.data.data;
        
        setAmazonResult({ product, pricing, message });
        
        // Amazon'dan gelen verileri form'a doldur
        setCurrentItem(prev => ({
          ...prev,
          isbn: code,
          amazonData: product,
          image: product.image || null,
          originalPrice: product.price,
          ourPrice: pricing.ourPrice
        }));
        
        // Kategori mapping
        const categoryMap: Record<string, "book" | "cd" | "dvd" | "game"> = {
          'books': 'book',
          'cds': 'cd', 
          'dvds': 'dvd',
          'games': 'game'
        };
        
        if (pricing.category && categoryMap[pricing.category]) {
          setCurrentItem(prev => ({
            ...prev,
            category: categoryMap[pricing.category]
          }));
        }
        
        // Eğer kabul edilmişse otomatik ekle
        if (pricing.accepted && pricing.ourPrice) {
          setTimeout(() => {
            autoAddAcceptedItem(code, product, pricing);
          }, 2000); // 2 saniye sonra otomatik ekle
        }
        
      } else {
        setError(response.data.error || 'Amazon kontrolü başarısız');
      }
      
    } catch (err: any) {
      console.error('Amazon API hatası:', err);
      setError(err.response?.data?.error || 'Amazon kontrolü sırasında hata oluştu');
    } finally {
      setIsCheckingAmazon(false);
    }
  }
  
  // Kabul edilen ürünü otomatik olarak listeye ekle
  const autoAddAcceptedItem = (isbn: string, product: AmazonProduct, pricing: PricingResult) => {
    if (!pricing.accepted || !pricing.ourPrice) return;
    
    const newItem: BundleItem = {
      id: Date.now().toString(),
      isbn: isbn,
      condition: "like-new",
      quantity: 1,
      price: pricing.ourPrice,
      image: product.image || null,
      imageBlob: null,
      category: getCategoryFromPricing(pricing.category),
      amazonData: product,
      ourPrice: pricing.ourPrice,
      originalPrice: product.price
    };
    
    setBundleItems(prev => [...prev, newItem]);
    
    // Form'u sıfırla
    setCurrentItem({
      id: "",
      isbn: "",
      condition: "like-new",
      quantity: 1,
      price: 0,
      image: null,
      imageBlob: null,
      category: "book"
    });
    
    setAmazonResult(null);
    setError("");
    
    // Başarı mesajı göster
    setTimeout(() => {
      setError("");
    }, 3000);
  };
  
  // Pricing category'sini BundleItem category'sine çevir
  const getCategoryFromPricing = (pricingCategory: string): "book" | "cd" | "dvd" | "game" | "mix" => {
    switch (pricingCategory) {
      case 'books': return 'book';
      case 'cds': return 'cd';
      case 'dvds': return 'dvd';
      case 'games': return 'game';
      default: return 'book';
    }
  };
  
  // Barcode tarama işlemini başlat
  const handleScanBarcode = () => {
    if (!isMobile) {
      setError("Barcode tarama sadece mobil cihazlarda çalışır");
      return;
    }
    
    setShowScanner(true);
    setScannerError("");
    setError("");
    setAmazonResult(null);
    
    // Scanner'ı başlat
    startScanning();
  };
  
  // Scanner'ı kapat
  const closeBarcodeScanner = () => {
    stopScanning();
    setShowScanner(false);
    setScannerError("");
  };
  
  // localStorage testi
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    let mounted = true;
    
    const initializeStorage = async () => {
      try {
        const testKey = 'storageTest_' + Date.now();
        localStorage.setItem(testKey, 'test');
        const testValue = localStorage.getItem(testKey);
        localStorage.removeItem(testKey);
        
        if (!mounted) return;
        
        if (testValue === 'test') {
          setIsPrivateMode(false);
        } else {
          throw new Error("Storage test failed");
        }
      } catch (e) {
        if (!mounted) return;
        setIsPrivateMode(true);
      } finally {
        if (mounted) {
          setIsMounted(true);
          setIsInitializing(false);
        }
      }
    };
    initializeStorage();
    
    return () => {
      mounted = false;
    };
  }, []);
  
  // Verileri localStorage'a kaydet (resimler hariç)
  const saveToStorage = useCallback(() => {
    if (!isMounted || isPrivateMode || isInitializing) return;
    
    try {
      const dataToSave = {
        bundleItems: bundleItems.map(item => ({
          ...item,
          image: null,      // Resimleri kaydetme
          imageBlob: null,  // Blob'ları kaydetme
          imageStats: null  // Stats'ları kaydetme
        })),
        currentItem: {
          ...currentItem,
          image: null,
          imageBlob: null,
          imageStats: null
        },
        timestamp: Date.now()
      };
      
      const storageKey = getStorageKey();
      localStorage.setItem(storageKey, JSON.stringify(dataToSave));
      console.log(`✅ Saved ${bundleItems.length} items to localStorage (without images)`);
      
    } catch (e) {
      console.error("Failed to save to localStorage", e);
    }
  }, [bundleItems, currentItem, isMounted, isPrivateMode, isInitializing, getStorageKey]);
  
  // Verileri localStorage'dan yükle
  const loadFromStorage = useCallback(() => {
    if (!isMounted || isPrivateMode || isInitializing) return;
    
    try {
      const storageKey = getStorageKey();
      const savedData = localStorage.getItem(storageKey);
      
      if (savedData) {
        const parsed = JSON.parse(savedData);
        console.log(`✅ Loaded ${parsed.bundleItems?.length || 0} items from localStorage`);
        
        setBundleItems(parsed.bundleItems || []);
        // Current item'ı yükleme (resimler olmadan)
        if (parsed.currentItem && parsed.currentItem.isbn) {
          setCurrentItem({
            ...parsed.currentItem,
            image: null,
            imageBlob: null,
            imageStats: null
          });
        }
      }
    } catch (e) {
      console.error("Failed to load from localStorage", e);
    }
  }, [isMounted, isPrivateMode, isInitializing, getStorageKey]);
  
  // İlk yüklemede verileri yükle
  useEffect(() => {
    if (isMounted && !isPrivateMode && !isInitializing) {
      loadFromStorage();
    }
  }, [isMounted, isPrivateMode, isInitializing, loadFromStorage]);
  
  // Değişiklikleri otomatik kaydet (debounced)
  useEffect(() => {
    if (!isMounted || isInitializing) return;
    
    const timeoutId = setTimeout(() => {
      saveToStorage();
    }, 1000); // 1 saniye debounce
    
    return () => clearTimeout(timeoutId);
  }, [bundleItems, saveToStorage, isMounted, isInitializing]);
  
  // User authentication kontrolü
  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);
  
  const handleCurrentItemChange = (field: keyof BundleItem, value: string | number) => {
    setCurrentItem(prev => ({
      ...prev,
      [field]: value
    }));
  };
  
  // YENİ: Optimize edilmiş image handler
  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      setImageProcessing(true);
      setError("");
      
      try {
        // Dosya tipi kontrolü
        if (!file.type.startsWith('image/')) {
          setError("Please select a valid image file");
          setImageProcessing(false);
          return;
        }
        
        // Resmi optimize et
        console.log(`Processing image: ${file.name} (${formatFileSize(file.size)})`);
        const { optimized, thumbnail, stats } = await smartOptimizeImage(file, {
          maxSizeMB: 1,      // 1MB hedef
          maxWidth: 1200,    // Max 1200px genişlik
          maxHeight: 1200,   // Max 1200px yükseklik
          quality: 0.85      // %85 kalite
        });
        
        // Optimization sonuçlarını göster
        console.log('Image optimization complete:', stats);
        
        // State'i güncelle
        setCurrentItem(prev => ({
          ...prev,
          image: thumbnail,        // Preview için thumbnail
          imageBlob: optimized,    // Upload için optimized blob
          imageStats: stats        // İstatistikler (opsiyonel gösterim için)
        }));
        
        // Başarı mesajı (opsiyonel)
        if (stats.optimized.compressionApplied) {
          console.log(`✅ Image optimized: ${stats.original.size} → ${stats.optimized.size} (${stats.optimized.compressionRatio}%)`);
        }
        
      } catch (error) {
        console.error("Error processing image:", error);
        setError("Failed to process image. Please try another image.");
      } finally {
        setImageProcessing(false);
      }
    }
  };
  
  const addNewItem = () => {
    // Form validasyonu
    if (!currentItem.isbn || currentItem.price <= 0) {
      setError("Please fill in ISBN and price (greater than 0) for the item");
      return;
    }
    
    // Yeni ürünü listeye ekle
    const newItem = {
      ...currentItem,
      id: Date.now().toString()
    };
    
    setBundleItems(prev => [...prev, newItem]);
    
    // Formu sıfırla
    setCurrentItem({
      id: "",
      isbn: "",
      condition: "like-new",
      quantity: 1,
      price: 0,
      image: null,
      imageBlob: null,
      category: "book"
    });
    
    setAmazonResult(null);
    setError("");
  };
  
  const removeItem = (id: string) => {
    setBundleItems(prev => prev.filter(item => item.id !== id));
  };
  
  const generateTitle = () => {
    const categoryCounts: Record<string, number> = {};
    const conditionCounts: Record<string, number> = {};
    
    bundleItems.forEach(item => {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
      conditionCounts[item.condition] = (conditionCounts[item.condition] || 0) + 1;
    });
    
    const dominantCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0];
    const dominantCondition = Object.entries(conditionCounts).sort((a, b) => b[1] - a[1])[0][0];
    const totalItems = bundleItems.reduce((sum, item) => sum + item.quantity, 0);
    
    const categoryNames = {
      book: "Book",
      cd: "CD",
      dvd: "DVD",
      game: "Game",
      mix: "Mixed Media"
    };
    
    const conditionNames = {
      "like-new": "Like New",
      "good": "Good"
    };
    
    return `${totalItems} ${categoryNames[dominantCategory as keyof typeof categoryNames]} Collection in ${conditionNames[dominantCondition as keyof typeof conditionNames]} Condition`;
  };
  
  // YENİ: Firebase Storage'a optimize edilmiş resim yükleme
  const uploadImageToStorage = async (item: BundleItem, userId: string): Promise<string | null> => {
    if (!item.imageBlob) return null;
    
    try {
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(7);
      const imagePath = `listings/${userId}/${timestamp}_${item.isbn}_${randomString}.jpg`;
      
      console.log(`Uploading image for ISBN ${item.isbn} to path: ${imagePath}`);
      
      // Firebase Storage'a yükle
      const storageRef = ref(storage, imagePath);
      const snapshot = await uploadBytes(storageRef, item.imageBlob);
      const downloadURL = await getDownloadURL(snapshot.ref);
      
      console.log(`✅ Image uploaded successfully: ${downloadURL}`);
      return downloadURL;
      
    } catch (error) {
      console.error(`Failed to upload image for ISBN ${item.isbn}:`, error);
      return null;
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");
    setUploadProgress("");
    
    try {
      if (bundleItems.length < 10) {
        setError("Please add at least 10 items to create a bundle listing");
        setIsSubmitting(false);
        return;
      }
      
      const title = generateTitle();
      setGeneratedTitle(title);
      
      // Resimleri Firebase Storage'a yükle
      setUploadProgress("Uploading images to cloud storage...");
      const uploadedItems = await Promise.all(
        bundleItems.map(async (item, index) => {
          setUploadProgress(`Uploading image ${index + 1} of ${bundleItems.length}...`);
          
          const imageUrl = await uploadImageToStorage(item, user!.uid);
          
          // Firestore için temiz obje oluştur (undefined field'ları kaldır)
          return {
            id: item.id,
            isbn: item.isbn,
            condition: item.condition,
            quantity: item.quantity,
            price: item.price,
            category: item.category,
            image: imageUrl || null  // undefined yerine null kullan
          };
        })
      );
      
      setUploadProgress("Saving listing to database...");
      
      // Toplam değeri hesapla
      const totalValue = uploadedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const totalItems = uploadedItems.reduce((sum, item) => sum + item.quantity, 0);
      
      // Firebase'e kaydet - sadece gerekli field'ları gönder
      const listingData = {
        title: title,
        description: `Bundle of ${totalItems} items including various categories.`,
        totalItems: totalItems,
        totalValue: totalValue,
        status: "pending",
        vendorId: user?.uid || "",
        vendorName: user?.displayName || user?.email?.split('@')[0] || "Anonymous",
        bundleItems: uploadedItems, // Temizlenmiş items
        createdAt: serverTimestamp(),
        views: 0
      };
      
      // Firestore'a ekle
      const docRef = await addDoc(collection(db, "listings"), listingData);
      console.log("✅ Document written with ID: ", docRef.id);
      
      // Başarılı mesajını göster
      setSuccess(true);
      setShowSuccess(true);
      setIsSubmitting(false);
      setUploadProgress("");
      
      // localStorage'dan taslağı temizle
      if (!isPrivateMode) {
        const storageKey = getStorageKey();
        localStorage.removeItem(storageKey);
        console.log("✅ Draft cleared from localStorage");
      }
      
      // 3 saniye sonra dashboard'a yönlendir
      setTimeout(() => {
        setShowSuccess(false);
        router.push("/dashboard");
      }, 3000);
      
    } catch (err) {
      console.error("Error creating listing:", err);
      setError("Failed to create listing. Please try again.");
      setIsSubmitting(false);
      setUploadProgress("");
    }
  };
  
  // Formu tamamen sıfırla
  const resetForm = () => {
    if (window.confirm("Are you sure you want to reset all data? This cannot be undone.")) {
      setBundleItems([]);
      setCurrentItem({
        id: "",
        isbn: "",
        condition: "like-new",
        quantity: 1,
        price: 0,
        image: null,
        imageBlob: null,
        category: "book"
      });
      setAmazonResult(null);
      setError("");
      
      if (typeof window !== 'undefined' && !isPrivateMode) {
        const storageKey = getStorageKey();
        localStorage.removeItem(storageKey);
      }
    }
  };
  
  if (loading || isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }
  
  if (!user) {
    return null;
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Head>
        <title>Create New Bundle Listing | MarketPlace</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>
      
      <main className="font-sans antialiased">
        <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          
          {/* Back to Dashboard Link */}
          <div className="mb-8 flex justify-between items-center">
            <Link 
              href="/dashboard" 
              className="inline-flex items-center px-4 py-3 bg-white rounded-xl shadow-sm text-sm font-medium text-blue-600 hover:text-blue-700 hover:shadow-md transition-all duration-200"
            >
              <FiHome className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
            
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center px-4 py-3 bg-white rounded-xl shadow-sm text-sm font-medium text-red-600 hover:text-red-700 hover:shadow-md transition-all duration-200"
            >
              <FiX className="mr-2 h-4 w-4" />
              Reset All
            </button>
          </div>
          
          {/* Mobile Check Warning */}
          {!isMobile && (
            <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-lg shadow-sm">
              <div className="flex">
                <div className="flex-shrink-0">
                  <FiAlertCircle className="h-5 w-5 text-yellow-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-yellow-700">
                    📱 Barcode tarama özelliği sadece mobil cihazlarda (iPhone/Android) çalışır. 
                    Bu sayfayı telefon veya tabletten açın.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Barcode Scanner Modal */}
          {showScanner && (
            <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 m-4 max-w-sm w-full">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">📱 Barcode Tarayıcı</h3>
                  <button
                    onClick={closeBarcodeScanner}
                    className="p-2 hover:bg-gray-100 rounded-full"
                  >
                    <FiX className="h-5 w-5" />
                  </button>
                </div>
                
                {!isCameraReady && !cameraError && (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Kamera hazırlanıyor...</p>
                  </div>
                )}
                
                {cameraError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <p className="text-red-700 text-sm">{cameraError}</p>
                  </div>
                )}
                
                {scannerError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <p className="text-red-700 text-sm">{scannerError}</p>
                  </div>
                )}
                
                <div className="relative">
                  <video
                    ref={videoRef}
                    className="w-full h-64 bg-black rounded-lg object-cover"
                    playsInline
                    muted
                  />
                  
                  {isCameraReady && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="border-2 border-red-500 w-48 h-32 rounded-lg"></div>
                    </div>
                  )}
                </div>
                
                <p className="text-center text-sm text-gray-600 mt-4">
                  Kamerayı barcode/QR kod üzerine tutun
                </p>
              </div>
            </div>
          )}
          
          {/* Main Card */}
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden transition-all duration-300 hover:shadow-2xl">
            {/* Header Section */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-8 py-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white">Create New Bundle Listing</h2>
                  <p className="mt-1 text-blue-100 max-w-2xl">
                    Scan barcode to automatically check Amazon pricing and add items to your bundle.
                  </p>
                </div>
                <div className="hidden md:block">
                  <div className="w-16 h-16 bg-blue-500 bg-opacity-30 rounded-full flex items-center justify-center">
                    <FiPackage className="h-8 w-8 text-white" />
                  </div>
                </div>
              </div>
            </div>
            
            {/* Success Message */}
            {showSuccess && (
              <div className="mx-6 mt-6 bg-green-50 border-l-4 border-green-500 p-4 rounded-lg shadow-sm">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <FiCheck className="h-5 w-5 text-green-500" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-green-700 font-medium">
                      Bundle "{generatedTitle}" created successfully! Your listing is now pending admin review.
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            {/* Upload Progress */}
            {uploadProgress && (
              <div className="mx-6 mt-6 bg-blue-50 border-l-4 border-blue-500 p-4 rounded-lg shadow-sm">
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-3"></div>
                  <p className="text-sm text-blue-700">{uploadProgress}</p>
                </div>
              </div>
            )}
            
            {/* Amazon Check Progress */}
            {isCheckingAmazon && (
              <div className="mx-6 mt-6 bg-blue-50 border-l-4 border-blue-500 p-4 rounded-lg shadow-sm">
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-3"></div>
                  <p className="text-sm text-blue-700">Amazon'da ürün aranıyor ve fiyat kontrolü yapılıyor...</p>
                </div>
              </div>
            )}
            
            {/* Amazon Result Card */}
            {amazonResult && (
              <div className="mx-6 mt-6">
                <div className={`border-l-4 p-4 rounded-lg shadow-sm ${
                  amazonResult.pricing.accepted 
                    ? 'bg-green-50 border-green-500' 
                    : 'bg-red-50 border-red-500'
                }`}>
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      {amazonResult.pricing.accepted ? (
                        <FiCheck className="h-5 w-5 text-green-500" />
                      ) : (
                        <FiX className="h-5 w-5 text-red-500" />
                      )}
                    </div>
                    <div className="ml-3 flex-1">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className={`text-sm font-medium ${
                            amazonResult.pricing.accepted ? 'text-green-800' : 'text-red-800'
                          }`}>
                            {amazonResult.product.title}
                          </h4>
                          <p className={`text-sm mt-1 ${
                            amazonResult.pricing.accepted ? 'text-green-700' : 'text-red-700'
                          }`}>
                            {amazonResult.message}
                          </p>
                          
                          {/* Ürün Detayları */}
                          <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <span className="font-medium">Amazon Fiyatı:</span>
                              <br />
                              ${amazonResult.product.price}
                            </div>
                            <div>
                              <span className="font-medium">Satış Sıralaması:</span>
                              <br />
                              #{amazonResult.product.sales_rank?.toLocaleString() || 'N/A'}
                            </div>
                            <div>
                              <span className="font-medium">Kategori:</span>
                              <br />
                              {amazonResult.pricing.category}
                            </div>
                            {amazonResult.pricing.accepted && (
                              <div>
                                <span className="font-medium">Bizim Fiyatımız:</span>
                                <br />
                                <span className="text-lg font-bold text-green-600">
                                  ${amazonResult.pricing.ourPrice}
                                </span>
                              </div>
                            )}
                          </div>
                          
                          {amazonResult.pricing.accepted && (
                            <div className="mt-3 text-xs text-green-600">
                              ⏱️ Bu ürün 2 saniye içinde otomatik olarak listeye eklenecek...
                            </div>
                          )}
                        </div>
                        
                        {/* Ürün Resmi */}
                        {amazonResult.product.image && (
                          <div className="ml-4 flex-shrink-0">
                            <img
                              src={amazonResult.product.image}
                              alt={amazonResult.product.title}
                              className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Error Message */}
            {error && (
              <div className="mx-6 mt-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-lg shadow-sm">
                <div className="flex items-start">
                  <div className="flex-shrink-0">
                    <FiAlertCircle className="h-5 w-5 text-red-500" />
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-red-700 font-medium">{error}</p>
                  </div>
                </div>
              </div>
            )}
            
            <form onSubmit={handleSubmit} className="px-6 py-6 space-y-8">
              {/* Current Item Form */}
              <div className="bg-gray-50 rounded-xl p-6 border border-gray-100 shadow-sm">
                <div className="flex items-center mb-5">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center mr-3">
                    <FiPackage className="h-5 w-5 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Add New Item</h3>
                  {isMobile && (
                    <span className="ml-auto inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      📱 Scanner Ready
                    </span>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* ISBN Input with Check and Scanner */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      ISBN/UPC
                    </label>
                    <div className="flex rounded-lg shadow-sm overflow-hidden border border-gray-300 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all duration-200">
                      <button
                        type="button"
                        onClick={() => handleBarcodeScanned(currentItem.isbn)}
                        disabled={isCheckingAmazon || !currentItem.isbn.trim()}
                        className={`inline-flex items-center px-4 py-3 border-r border-gray-300 text-gray-700 hover:bg-gray-100 focus:outline-none transition-colors duration-200 ${
                          !currentItem.isbn.trim() ? 'bg-gray-200 cursor-not-allowed' : 'bg-gray-50'
                        }`}
                        title="Check Amazon"
                      >
                        {isCheckingAmazon ? (
                          <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        ) : (
                          <FiSearch className="h-5 w-5" />
                        )}
                      </button>
                      <input
                        type="text"
                        value={currentItem.isbn}
                        onChange={(e) => handleCurrentItemChange('isbn', e.target.value)}
                        placeholder="Enter ISBN/UPC or scan barcode"
                        className="flex-1 block w-full px-4 py-3 border-0 focus:ring-0 text-base"
                        disabled={isCheckingAmazon}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter' && currentItem.isbn.trim()) {
                            handleBarcodeScanned(currentItem.isbn);
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleScanBarcode}
                        disabled={isCheckingAmazon || !isMobile}
                        className={`inline-flex items-center px-4 py-3 border-l border-gray-300 text-gray-700 hover:bg-gray-100 focus:outline-none transition-colors duration-200 ${
                          !isMobile ? 'bg-gray-200 cursor-not-allowed' : 'bg-gray-50'
                        }`}
                        title="Scan Barcode"
                      >
                        <FiCamera className="h-5 w-5" />
                      </button>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>🔍 Enter tuşu veya Check butonu ile kontrol edin</span>
                      {!isMobile && (
                        <span>📱 Barcode tarama sadece mobil cihazlarda çalışır</span>
                      )}
                    </div>
                  </div>
                  
                  {/* Category Selection - Amazon'dan otomatik doldurulabilir */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Category
                      {currentItem.amazonData && (
                        <span className="ml-2 text-xs text-green-600">📡 Amazon'dan</span>
                      )}
                    </label>
                    <div className="relative">
                      <select
                        value={currentItem.category}
                        onChange={(e) => handleCurrentItemChange('category', e.target.value)}
                        className="block w-full px-4 py-3 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 appearance-none bg-white"
                      >
                        <option value="book">Book</option>
                        <option value="cd">CD</option>
                        <option value="dvd">DVD</option>
                        <option value="game">Game</option>
                        <option value="mix">Mixed Media</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                        </svg>
                      </div>
                    </div>
                  </div>
                  
                  {/* Condition Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Condition
                    </label>
                    <div className="relative">
                      <select
                        value={currentItem.condition}
                        onChange={(e) => handleCurrentItemChange('condition', e.target.value)}
                        className="block w-full px-4 py-3 text-base border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 appearance-none bg-white"
                      >
                        <option value="like-new">Like New</option>
                        <option value="good">Good</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                        </svg>
                      </div>
                    </div>
                  </div>
                  
                  {/* Quantity */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Quantity
                    </label>
                    <div className="flex rounded-lg shadow-sm overflow-hidden border border-gray-300 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all duration-200">
                      <button
                        type="button"
                        onClick={() => handleCurrentItemChange('quantity', Math.max(1, currentItem.quantity - 1))}
                        className="px-4 py-3 bg-gray-50 text-gray-600 hover:bg-gray-100 border-r border-gray-300"
                      >
                        <FiMinus className="h-4 w-4" />
                      </button>
                      <input
                        type="number"
                        value={currentItem.quantity}
                        onChange={(e) => handleCurrentItemChange('quantity', parseInt(e.target.value) || 1)}
                        min="1"
                        className="flex-1 block w-full px-4 py-3 text-center border-0 focus:ring-0 text-base"
                      />
                      <button
                        type="button"
                        onClick={() => handleCurrentItemChange('quantity', currentItem.quantity + 1)}
                        className="px-4 py-3 bg-gray-50 text-gray-600 hover:bg-gray-100 border-l border-gray-300"
                      >
                        <FiPlus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  
                  {/* Price - Amazon'dan otomatik doldurulabilir */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Our Price ($)
                      {currentItem.ourPrice && (
                        <span className="ml-2 text-xs text-green-600">🤖 Auto-calculated</span>
                      )}
                    </label>
                    <div className="flex rounded-lg shadow-sm overflow-hidden border border-gray-300 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all duration-200">
                      <span className="inline-flex items-center px-4 bg-gray-50 text-gray-500 border-r border-gray-300">
                        <FiDollarSign className="h-5 w-5" />
                      </span>
                      <input
                        type="number"
                        value={currentItem.price}
                        onChange={(e) => handleCurrentItemChange('price', parseFloat(e.target.value) || 0)}
                        min="0"
                        max="10"
                        step="1"
                        placeholder="0"
                        className="flex-1 block w-full px-4 py-3 border-0 focus:ring-0 text-base"
                      />
                    </div>
                    {currentItem.originalPrice && (
                      <p className="text-xs text-gray-600 mt-1">
                        Amazon fiyatı: ${currentItem.originalPrice}
                      </p>
                    )}
                  </div>
                  
                  {/* Image Upload with Optimization */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Image
                      {currentItem.amazonData?.image && (
                        <span className="ml-2 text-xs text-green-600">📡 Amazon'dan</span>
                      )}
                    </label>
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-16 h-16 rounded-lg bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden shadow-sm">
                          {currentItem.image ? (
                            <img src={currentItem.image} alt="Preview" className="w-full h-full object-cover" />
                          ) : (
                            <FiPackage className="h-6 w-6 text-gray-400" />
                          )}
                        </div>
                      </div>
                      <div className="ml-4">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={imageProcessing}
                          className="inline-flex items-center px-3 py-2 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200 disabled:opacity-50"
                        >
                          {imageProcessing ? (
                            <>
                              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Processing...
                            </>
                          ) : (
                            <>
                              <FiUpload className="mr-1 h-4 w-4" />
                              Upload
                            </>
                          )}
                        </button>
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleImageChange}
                          className="hidden"
                          accept="image/*"
                        />
                        {currentItem.imageStats && (
                          <p className="text-xs text-green-600 mt-1">
                            ✅ {currentItem.imageStats.original.size} → {currentItem.imageStats.optimized.size}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Add Item Button */}
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={addNewItem}
                    disabled={isCheckingAmazon}
                    className="w-full flex justify-center py-3 px-4 border border-transparent shadow-sm text-base font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200 disabled:opacity-50"
                  >
                    <FiPlus className="mr-2 h-5 w-5" />
                    Add Item Manually
                  </button>
                </div>
              </div>
              
              {/* Added Items List */}
              <div className="bg-gray-50 rounded-xl p-6 border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center mr-3">
                      <FiPackage className="h-5 w-5 text-blue-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">Added Items</h3>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                      {bundleItems.length} item{bundleItems.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                
                {bundleItems.length < 10 && (
                  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6 rounded-lg shadow-sm">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <FiAlertCircle className="h-5 w-5 text-yellow-400" />
                      </div>
                      <div className="ml-3">
                        <p className="text-sm text-yellow-700">
                          You need to add at least 10 items to create a bundle listing. ({10 - bundleItems.length} more needed)
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                
                {bundleItems.length > 0 ? (
                  <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                    {bundleItems.map((item) => (
                      <div key={item.id} className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm transition-all duration-200 hover:shadow-md">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center">
                            {/* Fotoğraf varsa fotoğrafı göster, yoksa kategori ikonunu göster */}
                            <div className="w-16 h-16 rounded-md overflow-hidden mr-4 flex-shrink-0 border border-gray-200">
                              {item.image ? (
                                <img 
                                  src={item.image} 
                                  alt={`Item ${item.isbn}`} 
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                                  <span className="text-xl">
                                    {item.category === "book" ? "📚" : 
                                     item.category === "cd" ? "💿" : 
                                     item.category === "dvd" ? "📀" : 
                                     item.category === "game" ? "🎮" : "📦"}
                                  </span>
                                </div>
                              )}
                            </div>
                            
                            <div>
                              <h4 className="text-md font-medium text-gray-900">
                                {item.amazonData?.title || `ISBN: ${item.isbn}`}
                              </h4>
                              <p className="text-sm text-gray-600">
                                {item.category.charAt(0).toUpperCase() + item.category.slice(1)} • 
                                {item.condition === "like-new" ? "Like New" : "Good"} • 
                                Qty: {item.quantity} • 
                                Our Price: ${item.price.toFixed(2)}
                              </p>
                              
                              {/* Amazon Verileri */}
                              {item.amazonData && (
                                <div className="flex items-center space-x-4 mt-1">
                                  <span className="text-xs text-blue-600 flex items-center">
                                    <FiDollarSign className="h-3 w-3 mr-1" />
                                    Amazon: ${item.originalPrice}
                                  </span>
                                  {item.amazonData.sales_rank && (
                                    <span className="text-xs text-green-600 flex items-center">
                                      <FiTrendingUp className="h-3 w-3 mr-1" />
                                      Rank: #{item.amazonData.sales_rank.toLocaleString()}
                                    </span>
                                  )}
                                  <span className="text-xs text-purple-600 flex items-center">
                                    <FiStar className="h-3 w-3 mr-1" />
                                    Auto-added
                                  </span>
                                </div>
                              )}
                              
                              {item.imageStats && (
                                <p className="text-xs text-green-600 mt-1">
                                  📷 Image optimized: {item.imageStats.optimized.compressionRatio}% of original
                                </p>
                              )}
                              {!item.image && (
                                <p className="text-xs text-orange-600 mt-1">
                                  ⚠️ No image added
                                </p>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="p-1.5 rounded-full text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors duration-200"
                          >
                            <FiX className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <FiCamera className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No items added yet</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {isMobile ? "Scan barcodes to automatically add items" : "Add items using the form above"}
                    </p>
                  </div>
                )}
              </div>
              
              {/* Submit Button */}
              <div className="pt-5">
                <button
                  type="submit"
                  disabled={isSubmitting || bundleItems.length < 10}
                  className="w-full flex justify-center py-4 px-6 border border-transparent shadow-lg text-base font-medium rounded-xl text-white bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-all duration-200 transform hover:-translate-y-0.5"
                >
                  {isSubmitting ? (
                    <div className="flex items-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Creating Bundle...
                    </div>
                  ) : (
                    <div className="flex items-center">
                      <FiSave className="mr-2 h-5 w-5" />
                      Create Bundle Listing ({bundleItems.length}/10 items)
                    </div>
                  )}
                </button>
              </div>
            </form>
          </div>
          
          {/* Info Box */}
          <div className="mt-8 bg-blue-50 rounded-lg p-4 border border-blue-200">
            <h3 className="text-sm font-medium text-blue-900 mb-2">📱 How it works</h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• Scan barcode on your mobile device to automatically check Amazon pricing</li>
              <li>• Items meeting our criteria are automatically added with calculated pricing</li>
              <li>• Rejected items show detailed reason (price range, sales rank, etc.)</li>
              <li>• Images and product details are fetched from Amazon automatically</li>
              <li>• Manual entry is still available for items without barcodes</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}