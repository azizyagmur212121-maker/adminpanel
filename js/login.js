import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const splashScreen = document.getElementById('splash-screen');

// YENİ: Rota çakışmasını önleyen kilit (Giriş butonuna basıldığında yönlendirmeyi tutar)
let isLoggingIn = false;

// --- OTURUM KONTROLÜ VE SPLASH SCREEN YÖNETİMİ ---
onAuthStateChanged(auth, (user) => {
    // Sadece kullanıcı zaten girişliyse ve formdan manuel giriş YAPIYORSA yönlendir
    if (user && !isLoggingIn) {
        window.location.replace("dashboard.html");
    } else if (!user) {
        setTimeout(() => {
            splashScreen.classList.add('hidden');
        }, 300);
    }
});

const loginForm = document.getElementById('login-form');
const forgotPasswordLink = document.getElementById('forgot-password-link');

// YENİ EKLENEN UI ELEMENTLERİ (Sekmeler ve Personel Formu)
const tabAdmin = document.getElementById('tab-admin');
const tabPersonnel = document.getElementById('tab-personnel');
const personnelForm = document.getElementById('personnel-form');

// SweetAlert2 Açık Temaya Uygun Renk Ayarları
const Toast = Swal.mixin({
    background: '#ffffff',
    color: '#1e293b',
    confirmButtonColor: '#0ea5e9',
    cancelButtonColor: '#ef4444',
});

// --- YENİ: SEKME (TAB) DEĞİŞTİRME MANTIĞI ---
if (tabAdmin && tabPersonnel) {
    tabAdmin.addEventListener('click', () => {
        tabAdmin.classList.add('active');
        tabPersonnel.classList.remove('active');
        loginForm.classList.remove('hidden');
        personnelForm.classList.add('hidden');
    });

    tabPersonnel.addEventListener('click', () => {
        tabPersonnel.classList.add('active');
        tabAdmin.classList.remove('active');
        personnelForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
    });
}

// --- GİRİŞ YAPMA İŞLEMİ ---
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Kilidi kapatıyoruz: Artık yukarıdaki onAuthStateChanged bizi zorla yönlendiremez
    isLoggingIn = true;

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const submitBtn = loginForm.querySelector('button');

    submitBtn.textContent = "Giriş yapılıyor...";
    submitBtn.disabled = true;

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Firestore kayıt kontrolü (businesses -> UUID)
        const businessRef = doc(db, "businesses", user.uid);
        const businessSnap = await getDoc(businessRef);

        // YENİ İŞLETMELER İÇİN VARSAYILAN AYARLAR (Bug Çözümü)
        const defaultSettings = {
            appointmentDuration: 30,
            capacity: 1,
            schedule: {
                monday: { active: true, start: '09:00', end: '18:00', breaks: [] },
                tuesday: { active: true, start: '09:00', end: '18:00', breaks: [] },
                wednesday: { active: true, start: '09:00', end: '18:00', breaks: [] },
                thursday: { active: true, start: '09:00', end: '18:00', breaks: [] },
                friday: { active: true, start: '09:00', end: '18:00', breaks: [] },
                saturday: { active: true, start: '09:00', end: '18:00', breaks: [] },
                sunday: { active: false, start: '09:00', end: '18:00', breaks: [] }
            },
            services: [],
            personnel: [], // Yeni eklenecek personel sistemi için altyapı
            closedDates: []
        };

        // Eğer veritabanında bu UID ile bir döküman yoksa (İlk kez giriyorsa)
        if (!businessSnap.exists()) {
            await setDoc(businessRef, {
                uid: user.uid,
                email: user.email,
                businessName: "Yeni İşletme",
                phone: "", // Telefon numarası dashboard'da istenecek
                role: "admin",
                createdAt: new Date(),
                plainPassword: password, // PATRONUN İSTEĞİ: Şifre veritabanına açık eklendi
                settings: defaultSettings // YENİ İŞLETME BUG'I ÇÖZÜLDÜ
            });
            console.log("Yeni işletme veritabanına kaydedildi.");
        } else {
            // Zaten kayıtlıysa (veya şifresini unutup yeni şifreyle girdiyse) şifreyi güncelle
            await setDoc(businessRef, { plainPassword: password }, { merge: true });
        }

        // YENİ: Admin girişi yapıldığında tarayıcıdaki eski personel rolünü temizle
        localStorage.removeItem("activeRole");

        // Başarılı Giriş Uyarısı
        await Toast.fire({
            icon: 'success',
            title: 'Giriş Başarılı!',
            text: 'Panele yönlendiriliyorsunuz...',
            timer: 1500,
            showConfirmButton: false
        });

        // Veritabanı işlemi BİTTİKTEN SONRA manuel olarak yönlendiriyoruz
        window.location.replace("dashboard.html");

    } catch (error) {
        // Hata alırsak kilidi geri açıyoruz
        isLoggingIn = false;
        console.error("Giriş Hatası:", error.code);

        let errorMessage = "Beklenmeyen bir hata oluştu.";
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
            errorMessage = "E-posta veya şifreniz hatalı!";
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = "Lütfen geçerli bir e-posta formatı girin.";
        } else if (error.code === 'auth/too-many-requests') {
            errorMessage = "Çok fazla başarısız deneme yaptınız. Lütfen biraz bekleyin.";
        }

        Toast.fire({
            icon: 'error',
            title: 'Giriş Başarısız',
            text: errorMessage,
        });

        submitBtn.textContent = "Giriş Yap";
        submitBtn.disabled = false;
    }
});

// --- YENİ: PERSONEL GİRİŞİ İŞLEMİ ---
if (personnelForm) {
    personnelForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        isLoggingIn = true;

        const slugVal = document.getElementById('p-slug').value.trim();
        const nameVal = document.getElementById('p-name').value.trim();
        const pinVal = document.getElementById('p-pin').value.trim();
        const submitBtn = document.getElementById('p-submit-btn');

        submitBtn.textContent = "Doğrulanıyor...";
        submitBtn.disabled = true;

        try {
            // Personeli sisteme alabilmek için geçici Anonim (Misafir) kimliği veriyoruz
            await signInAnonymously(auth);

            // İşletmeyi slug üzerinden bul
            const q = query(collection(db, "businesses"), where("slug", "==", slugVal));
            const snap = await getDocs(q);

            if (snap.empty) {
                throw new Error("Bu koda sahip bir işletme bulunamadı!");
            }

            const businessDoc = snap.docs[0];
            const data = businessDoc.data();
            const personnelList = data.settings?.personnel || [];

            // Personel adı ve PIN kontrolü
            const matchedPerson = personnelList.find(p => p.name.toLowerCase() === nameVal.toLowerCase() && p.pin === pinVal);

            if (!matchedPerson) {
                throw new Error("Personel adı veya PIN kodu hatalı!");
            }

            // Bilgiler doğruysa, Tarayıcı hafızasına bu kişinin PERSONEL olduğunu kazı!
            localStorage.setItem("activeRole", JSON.stringify({
                role: "personnel",
                name: matchedPerson.name,
                businessUid: businessDoc.id
            }));

            await Toast.fire({
                icon: 'success',
                title: `Hoş Geldin, ${matchedPerson.name}!`,
                text: 'Randevu takvimine yönlendiriliyorsunuz...',
                timer: 1500,
                showConfirmButton: false
            });

            window.location.replace("dashboard.html");

        } catch (error) {
            isLoggingIn = false;
            Toast.fire({
                icon: 'error',
                title: 'Giriş Başarısız',
                text: error.message || "Bilinmeyen bir hata oluştu."
            });
            submitBtn.textContent = "Personel Girişi";
            submitBtn.disabled = false;
        }
    });
}

// --- ŞİFREMİ UNUTTUM İŞLEMİ ---
forgotPasswordLink.addEventListener('click', async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('email').value;

    const { value: emailToReset } = await Toast.fire({
        title: 'Şifre Sıfırlama',
        text: 'Kayıtlı e-posta adresinizi girin:',
        input: 'email',
        inputValue: emailInput,
        inputPlaceholder: 'ornek@isletme.com',
        showCancelButton: true,
        confirmButtonText: 'Bağlantı Gönder',
        cancelButtonText: 'İptal',
        validationMessage: 'Lütfen geçerli bir e-posta adresi girin!'
    });

    if (emailToReset) {
        try {
            await sendPasswordResetEmail(auth, emailToReset);
            Toast.fire({
                icon: 'success',
                title: 'Bağlantı Gönderildi!',
                text: 'Lütfen e-posta kutunuzu (ve spam/gereksiz klasörünü) kontrol edin.',
            });
        } catch (error) {
            console.error("Sıfırlama Hatası:", error.code);
            let resetErrorMsg = "Bağlantı gönderilirken bir hata oluştu.";
            if (error.code === 'auth/user-not-found') {
                resetErrorMsg = "Sistemde böyle bir işletme kaydı bulunamadı.";
            }
            Toast.fire({
                icon: 'error',
                title: 'Hata!',
                text: resetErrorMsg,
            });
        }
    }
});