import React, { useState } from 'react';
import { 
  X, 
  Upload, 
  CheckCircle, 
  AlertCircle, 
  User, 
  Package, 
  MapPin, 
  Calendar, 
  Phone, 
  ShieldAlert,
  Loader2,
  Copy,
  Check,
  ArrowRight,
  Plus
} from 'lucide-react';
import { DIVISIONS, DISTRICTS, getDistrictsByDivision } from '../data/bangladeshData';
import { ReportType } from '../types';
import { submitPublicReport } from '../services/reportService';
import { compressImageFile } from '../utils/imageCompressor';

interface ReportSubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: ReportType;
  onSuccess: (reportId: string) => void;
}

export const ReportSubmissionModal: React.FC<ReportSubmissionModalProps> = ({
  isOpen,
  onClose,
  initialType = 'missing_person',
  onSuccess
}) => {
  const [reportType, setReportType] = useState<ReportType>(initialType);
  const [division, setDivision] = useState('dhaka');
  const [district, setDistrict] = useState('dhaka');
  const [upazila, setUpazila] = useState('');
  
  // Person fields
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('male');
  const [height, setHeight] = useState('');
  const [skinColor, setSkinColor] = useState('');
  const [clothing, setClothing] = useState('');
  const [identificationMarks, setIdentificationMarks] = useState('');
  
  // Item fields
  const [itemName, setItemName] = useState('');
  const [itemCategory, setItemCategory] = useState('স্মার্টফোন');
  const [itemBrand, setItemBrand] = useState('');
  const [itemColor, setItemColor] = useState('');
  
  // Common incident fields
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [incidentDate, setIncidentDate] = useState(new Date().toISOString().split('T')[0]);
  const [incidentTime, setIncidentTime] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  
  // Contact details
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactMethod, setContactMethod] = useState('সরাসরি ফোন কল ও হোয়াটসঅ্যাপ');

  // Submission State
  const [submitting, setSubmitting] = useState(false);
  const [compressingImage, setCompressingImage] = useState(false);
  const [submittedReportId, setSubmittedReportId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const handleCopyId = () => {
    if (!submittedReportId) return;
    navigator.clipboard.writeText(submittedReportId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2500);
  };

  if (!isOpen) return null;

  // Available districts based on chosen division
  const availableDistricts = getDistrictsByDivision(division);
  const currentDistrictObj = DISTRICTS.find(d => d.id === district) || availableDistricts[0];

  const handleDivisionChange = (divId: string) => {
    setDivision(divId);
    const districtsInDiv = getDistrictsByDivision(divId);
    if (districtsInDiv.length > 0) {
      setDistrict(districtsInDiv[0].id);
      setUpazila(districtsInDiv[0].upazilas[0] || '');
    }
  };

  const handleDistrictChange = (distId: string) => {
    setDistrict(distId);
    const distObj = DISTRICTS.find(d => d.id === distId);
    if (distObj && distObj.upazilas.length > 0) {
      setUpazila(distObj.upazilas[0]);
    }
  };

  // High-performance image upload & canvas compression
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    if (file.size > 15 * 1024 * 1024) {
      alert('ছবির আকার সর্বোচ্চ ১৫ মেগাবাইট হতে পারবে।');
      return;
    }

    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('শুধুমাত্র JPG, PNG বা WEBP ছবি গ্রহণযোগ্য।');
      return;
    }

    setCompressingImage(true);
    try {
      // Automatically compress and resize to ~50KB to guarantee instant submission without network/quota failure
      const compressedDataUrl = await compressImageFile(file, 800, 800, 0.78);
      setPhotos([compressedDataUrl]);
    } catch (err: any) {
      console.warn('Image compression error, falling back:', err);
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setPhotos([event.target.result as string]);
        }
      };
      reader.readAsDataURL(file);
    } finally {
      setCompressingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validation
    if (!contactPhone.trim() || !contactName.trim()) {
      setErrorMessage('অনুগ্রহ করে যোগাযোগের নাম এবং মোবাইল নম্বর প্রদান করুন।');
      return;
    }

    const isPerson = reportType === 'missing_person' || reportType === 'found_person';
    const computedTitle = title.trim() || (isPerson 
      ? `${name || 'অজ্ঞাত ব্যক্তি'} - ${reportType === 'missing_person' ? 'নিখোঁজ' : 'পাওয়া গেছে'}`
      : `${itemName || 'জিনিস'} - ${reportType === 'lost_item' ? 'হারানো' : 'পাওয়া গেছে'}`);

    if (isPerson && !name.trim()) {
      setErrorMessage('অনুগ্রহ করে ব্যক্তির নাম অথবা "অজ্ঞাত" উল্লেখ করুন।');
      return;
    }

    if (!isPerson && !itemName.trim()) {
      setErrorMessage('অনুগ্রহ করে জিনিসের নাম উল্লেখ করুন।');
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitPublicReport({
        type: reportType,
        category: isPerson 
          ? (age ? `${age} বয়সী` : 'সাধারণ') 
          : itemCategory,
        title: computedTitle,
        name: isPerson ? name : itemName,
        nickname: nickname,
        age: age,
        gender: isPerson ? gender : undefined,
        photos: photos.length > 0 ? photos : [],
        description: description || 'বিস্তারিত তথ্য পরবর্তীতে আপডেট করা হবে।',
        division,
        district: currentDistrictObj?.nameBn || district,
        upazila: upazila || currentDistrictObj?.upazilas[0] || '',
        location: location || currentDistrictObj?.nameBn || 'অজ্ঞাত এলাকা',
        incidentDate,
        incidentTime,
        clothing: clothing,
        physicalDescription: height ? `উচ্চতা: ${height}, বর্ণ: ${skinColor}` : skinColor,
        identificationMarks,
        contactName,
        contactPhone,
        contactMethod
      });

      setSubmittedReportId(result.reportId);
      onSuccess(result.reportId);
    } catch (err) {
      console.error(err);
      setErrorMessage('দুঃখিত, তথ্যটি এখন জমা দেওয়া যাচ্ছে না। ইন্টারনেট সংযোগ পরীক্ষা করে পুনরায় চেষ্টা করুন।');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmittedReportId(null);
    setName('');
    setItemName('');
    setTitle('');
    setDescription('');
    setPhotos([]);
    setErrorMessage(null);
    setCopiedId(false);
  };

  const handleCloseAndReset = () => {
    resetForm();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {submittedReportId ? 'রিপোর্ট সফলভাবে জমা হয়েছে' : 'নতুন তথ্য বা রিপোর্ট জমা দিন'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {submittedReportId 
                ? 'আপনার তথ্যটি অ্যাডমিন প্যানেলে জমা হয়েছে এবং যাচাই শেষে সাইটে পাবলিক হবে' 
                : 'যাচাইকরণের পর আপনার তথ্যটি সারা বাংলাদেশে প্রকাশিত হবে'}
            </p>
          </div>
          <button
            onClick={handleCloseAndReset}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          {/* Success Screen */}
          {submittedReportId ? (
            <div className="text-center py-4 px-2 sm:px-4 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto shadow-inner ring-4 ring-emerald-50">
                <CheckCircle className="w-10 h-10" />
              </div>

              <div>
                <h3 className="text-2xl font-black text-slate-900">
                  আপনার রিপোর্ট সফলভাবে গৃহীত হয়েছে!
                </h3>
                <p className="text-xs text-emerald-700 font-semibold mt-1">
                  অ্যাডমিন ড্যাশবোর্ডে তাৎক্ষণিক জমা হয়েছে এবং নোটিফিকেশন পাঠানো হয়েছে
                </p>
              </div>

              {/* Tracking ID with Copy Button */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 max-w-md mx-auto text-center space-y-2">
                <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">আপনার ট্র্যাকিং আইডি</p>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-2xl sm:text-3xl font-mono font-extrabold text-emerald-800 tracking-wider">
                    {submittedReportId}
                  </span>
                  <button
                    onClick={handleCopyId}
                    type="button"
                    className="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                    title="আইডি কপি করুন"
                  >
                    {copiedId ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span className="text-[11px]">কপি হয়েছে!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span className="text-[11px]">কপি</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  ভবিষ্যতে তথ্যের আপডেট বা অনুসন্ধানের সুবিধার্থে এই আইডিটি সংরক্ষণ করুন।
                </p>
              </div>

              {/* Workflow notice */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-700 text-left space-y-2 max-w-md mx-auto">
                <div className="flex items-center gap-2 text-slate-900 font-bold">
                  <ShieldAlert className="w-4 h-4 text-emerald-600" />
                  <span>পরবর্তী ধাপসমূহ (Workflow):</span>
                </div>
                <div className="space-y-1.5 pl-2 text-[11px] text-slate-600">
                  <div className="flex items-start gap-1.5">
                    <span className="font-bold text-emerald-700">১.</span>
                    <span><strong>অ্যাডমিন ড্যাশবোর্ড:</strong> আপনার রিপোর্টটি অ্যাডমিন প্যানেলে পর্যালোচনার জন্য জমা হয়ে গেছে।</span>
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="font-bold text-emerald-700">২.</span>
                    <span><strong>অনুমোদন ও প্রকাশ:</strong> অ্যাডমিন প্যানেল থেকে তথ্যটি যাচাই করে 'সাইটে প্রকাশ' করলেই এটি সারা দেশে সবার জন্য উন্মুক্ত হবে।</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto">
                <button
                  type="button"
                  onClick={resetForm}
                  className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>আরেকটি রিপোর্ট জমা দিন</span>
                </button>

                <button
                  type="button"
                  onClick={handleCloseAndReset}
                  className="w-full sm:w-auto px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl text-xs shadow-md transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>সম্পন্ন (হোমে ফিরে যান)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            /* Submission Form */
            <form onSubmit={handleSubmit} className="space-y-5">
              {errorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Type Switcher Tabs */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  রিপোর্টের ধরন নির্বাচন করুন *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setReportType('missing_person')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      reportType === 'missing_person'
                        ? 'bg-red-50 border-red-500 text-red-800 ring-2 ring-red-400/20'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <User className="w-3.5 h-3.5 text-red-600" />
                    <span>নিখোঁজ ব্যক্তি</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setReportType('found_person')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      reportType === 'found_person'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-400/20'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>পাওয়া ব্যক্তি</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setReportType('lost_item')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      reportType === 'lost_item'
                        ? 'bg-amber-50 border-amber-500 text-amber-800 ring-2 ring-amber-400/20'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5 text-amber-600" />
                    <span>হারানো জিনিস</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setReportType('found_item')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      reportType === 'found_item'
                        ? 'bg-teal-50 border-teal-500 text-teal-800 ring-2 ring-teal-400/20'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <CheckCircle className="w-3.5 h-3.5 text-teal-600" />
                    <span>পাওয়া জিনিস</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Form Sections */}
              {(reportType === 'missing_person' || reportType === 'found_person') ? (
                /* Person Details */
                <div className="space-y-3.5 pt-2 border-t border-slate-100">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    ব্যক্তির বিবরণ
                  </h4>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        পুরো নাম *
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="যেমন: আরিয়ান রহমান"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        ডাকনাম
                      </label>
                      <input
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder="যেমন: আরিয়ান"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        বয়স
                      </label>
                      <input
                        type="text"
                        value={age}
                        onChange={(e) => setAge(e.target.value)}
                        placeholder="যেমন: ৭ বছর"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        লিঙ্গ
                      </label>
                      <select
                        value={gender}
                        onChange={(e) => setGender(e.target.value as any)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden bg-white"
                      >
                        <option value="male">পুরুষ</option>
                        <option value="female">নারী</option>
                        <option value="other">অন্যান্য</option>
                      </select>
                    </div>

                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        উচ্চতা
                      </label>
                      <input
                        type="text"
                        value={height}
                        onChange={(e) => setHeight(e.target.value)}
                        placeholder="যেমন: ৫ ফুট ৩ ইঞ্চি"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        পোশাকের বিবরণ
                      </label>
                      <input
                        type="text"
                        value={clothing}
                        onChange={(e) => setClothing(e.target.value)}
                        placeholder="যেমন: লাল টি-শার্ট ও নীল জিন্স"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        বিশেষ শনাক্তকারী বৈশিষ্ট্য
                      </label>
                      <input
                        type="text"
                        value={identificationMarks}
                        onChange={(e) => setIdentificationMarks(e.target.value)}
                        placeholder="যেমন: কপালে কাটা দাগ, ডান হাতে তিল"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* Item Details */
                <div className="space-y-3.5 pt-2 border-t border-slate-100">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    জিনিসের বিবরণ
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        জিনিসের নাম *
                      </label>
                      <input
                        type="text"
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        placeholder="যেমন: কালো রঙের ব্যাকপ্যাক"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        ক্যাটাগরি
                      </label>
                      <select
                        value={itemCategory}
                        onChange={(e) => setItemCategory(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden bg-white"
                      >
                        <option value="স্মার্টফোন">স্মার্টফোন / মোবাইল</option>
                        <option value="ল্যাপটপ ও ইলেকট্রনিক্স">ল্যাপটপ ও ইলেকট্রনিক্স</option>
                        <option value="ব্যাগ ও নথিপত্র">ব্যাগ ও নথিপত্র</option>
                        <option value="মানিব্যাগ ও কার্ড">মানিব্যাগ ও আইডি কার্ড</option>
                        <option value="গাড়ি বা মোটরসাইকেল">গাড়ি বা মোটরসাইকেল</option>
                        <option value="অন্যান্য প্রয়োজনীয় জিনিস">অন্যান্য প্রয়োজনীয় জিনিস</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        ব্র্যান্ড বা মডেল
                      </label>
                      <input
                        type="text"
                        value={itemBrand}
                        onChange={(e) => setItemBrand(e.target.value)}
                        placeholder="যেমন: Dell / Samsung"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        রং বা বিশেষ চিহ্ন
                      </label>
                      <input
                        type="text"
                        value={itemColor}
                        onChange={(e) => setItemColor(e.target.value)}
                        placeholder="যেমন: গাঢ় নীল, সোনালী চেইন"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Photo Upload */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  ছবি আপলোড করুন (পরিষ্কার ছবি দ্রুত শনাক্তে সাহায্য করে)
                </label>
                <div className="mt-1 flex items-center gap-4">
                  {compressingImage ? (
                    <div className="flex flex-col items-center justify-center w-full h-24 border-2 border-emerald-500 rounded-xl bg-emerald-50/50">
                      <Loader2 className="w-6 h-6 text-emerald-600 animate-spin mb-1" />
                      <span className="text-xs text-emerald-800 font-semibold">ছবি অপটিমাইজ করা হচ্ছে...</span>
                    </div>
                  ) : photos.length > 0 ? (
                    <div className="relative w-28 h-28 rounded-xl overflow-hidden border border-slate-200 shadow-xs">
                      <img src={photos[0]} alt="Preview" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setPhotos([])}
                        className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full hover:bg-red-700 shadow-md cursor-pointer"
                        title="ছবি মুছে ফেলুন"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-xl cursor-pointer bg-slate-50 hover:bg-emerald-50/30 transition">
                      <Upload className="w-6 h-6 text-slate-400 mb-1" />
                      <span className="text-xs text-slate-600 font-medium">ছবি নির্বাচন করতে ক্লিক করুন</span>
                      <span className="text-[10px] text-slate-400">JPG, PNG, WEBP (ক্যামেরা বা গ্যালারি থেকে)</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Location Hierarchy: Division -> District -> Upazila */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                  <span>স্থান ও এলাকা সংক্রান্ত তথ্য *</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      বিভাগ *
                    </label>
                    <select
                      value={division}
                      onChange={(e) => handleDivisionChange(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden bg-white"
                    >
                      {DIVISIONS.map(d => (
                        <option key={d.id} value={d.id}>{d.nameBn} বিভাগ</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      জেলা *
                    </label>
                    <select
                      value={district}
                      onChange={(e) => handleDistrictChange(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden bg-white"
                    >
                      {availableDistricts.map(d => (
                        <option key={d.id} value={d.id}>{d.nameBn}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      উপজেলা / থানা
                    </label>
                    <select
                      value={upazila}
                      onChange={(e) => setUpazila(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden bg-white"
                    >
                      {currentDistrictObj.upazilas.map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    সর্বশেষ দেখা সুনির্দিষ্ট স্থান বা মহল্লা *
                  </label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="যেমন: শেরপুর পৌর পার্ক মোড় / ধানমন্ডি লেক"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      ঘটনার তারিখ *
                    </label>
                    <input
                      type="date"
                      value={incidentDate}
                      onChange={(e) => setIncidentDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden bg-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      সময় (আনুমানিক)
                    </label>
                    <input
                      type="text"
                      value={incidentTime}
                      onChange={(e) => setIncidentTime(e.target.value)}
                      placeholder="যেমন: বিকাল ৫:৩০"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  বিস্তারিত ঘটনা ও অতিরিক্ত তথ্য
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="কীভাবে ঘটনাটি ঘটেছিল বা জরুরি কোনো তথ্য থাকলে বিস্তারিত লিখুন..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                />
              </div>

              {/* Contact Information */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-600" />
                  <span>জরুরি যোগাযোগের তথ্য (যাচাইয়ের জন্য আবশ্যক) *</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      যোগাযোগকারীর নাম *
                    </label>
                    <input
                      type="text"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="যেমন: আব্দুর রহমান (পিতা/মালিক)"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      মোবাইল নম্বর *
                    </label>
                    <input
                      type="tel"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="01711-234567"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Notice & Submit Button */}
              <div className="pt-4 border-t border-slate-200">
                <div className="text-[11px] text-slate-500 mb-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  ⚠️ মিথ্যা বা বিভ্রান্তিকর তথ্য প্রদান আইনত দণ্ডনীয়। জমাকৃত তথ্য পর্যালোচনার পরেই কেবল সাইটে দৃশ্যমান করা হবে।
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-semibold transition cursor-pointer"
                  >
                    বাতিল
                  </button>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-400 text-white font-bold rounded-xl shadow-md transition flex items-center gap-2 cursor-pointer"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>{submitting ? 'জমা হচ্ছে...' : 'রিপোর্ট জমা দিন'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
