import image_23c164f9c2d47a333b433752a1afdd33f5e1087b from 'figma:asset/23c164f9c2d47a333b433752a1afdd33f5e1087b.png';
import image_0ad5ea24556a5ab1b943fa69ad19a32dec645d73 from 'figma:asset/0ad5ea24556a5ab1b943fa69ad19a32dec645d73.png';
import image_079f9f9951d9673b241dbc26452fd217030dc52c from 'figma:asset/079f9f9951d9673b241dbc26452fd217030dc52c.png';
import image_e538d367f64f8eef0d7dfe26310e4d2a2e90db75 from 'figma:asset/e538d367f64f8eef0d7dfe26310e4d2a2e90db75.png';
import passportImage from 'figma:asset/fdf9534f400a4625e58921a0bd6202d55336338f.png';
import uploadedPassportImage from 'figma:asset/e8c47b58f9def1f49ff16b36b843a9e87b730214.png';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import {
  ChevronDown,
  Upload,
  Plus,
  X,
  ArrowRight,
  ArrowUpRight,
  FileText,
  LogOut,
  Globe,
  Loader2,
  HelpCircle,
  CircleCheck,
  Paperclip,
  Send,
  MessageCircle,
  Hourglass,
  Copy,
  FileSearch,
} from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import {
  useRegisterUIAction,
  useRegisterTabSwitchAction,
  useRegisterSubmitAction,
  useRegisterFormField,
} from '@unctad-ai/voice-agent-registries';

type Tab = 'form' | 'send';

interface Director {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  gender: 'male' | 'female' | '';
  passportNumber: string;
  issuingCountry: string;
  issueDate: string;
  expiryDate: string;
  address: string;
  town: string;
  country: string;
  countryCode: string;
  mobileNumber: string;
  email: string;
  acknowledgementNumber: string;
  resultMessage: string;
  passportFile: File | null;
}

export default function PinRegistrationApplication() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('form');
  const [directors, setDirectors] = useState<Director[]>([]);
  const [showDirectorForm, setShowDirectorForm] = useState(false);
  const [editingDirectorId, setEditingDirectorId] = useState<string | null>(null);
  const [hasProjectReference, setHasProjectReference] = useState<'yes' | 'no' | null>(null);
  const [projectReference, setProjectReference] = useState('');
  const [consentChecked, setConsentChecked] = useState(true);
  const [isProcessingPassport, setIsProcessingPassport] = useState(false);
  const [hasUploadedFile, setHasUploadedFile] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [showProjectReferenceSection, setShowProjectReferenceSection] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Set<string>>(new Set());
  const [projectDataQueried, setProjectDataQueried] = useState(false);
  const [isQueryingProject, setIsQueryingProject] = useState(false);

  // Project form data
  const [projectName, setProjectName] = useState('');
  const [projectAddress, setProjectAddress] = useState('');
  const [projectCounty, setProjectCounty] = useState('');
  const [projectSubCounty, setProjectSubCounty] = useState('');
  const [projectTown, setProjectTown] = useState('');
  const [projectSector, setProjectSector] = useState('');
  const [projectActivity, setProjectActivity] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectNationality, setProjectNationality] = useState('');
  const [projectAmount, setProjectAmount] = useState('');
  const [projectLocalStaff, setProjectLocalStaff] = useState('');
  const [projectForeignStaff, setProjectForeignStaff] = useState('');

  // Ref for scrolling to project information section
  const projectInfoRef = useRef<HTMLDivElement>(null);

  // Ref for scrolling to personal details section
  const personalDetailsRef = useRef<HTMLDivElement>(null);

  const [currentDirector, setCurrentDirector] = useState<Director>({
    id: '',
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '',
    nationality: '',
    gender: '',
    passportNumber: '',
    issuingCountry: '',
    issueDate: '',
    expiryDate: '',
    address: '',
    town: '',
    country: '',
    countryCode: '',
    mobileNumber: '',
    email: '',
    acknowledgementNumber: '',
    resultMessage: '',
    passportFile: null,
  });

  const [isInfoCardOpen, setIsInfoCardOpen] = useState(false);

  // --- Form Field Registry: project fields (only when project section is visible) ---
  const projectFieldsVisible = hasProjectReference === 'no' || projectDataQueried;
  useRegisterFormField({
    id: 'pin-reg.project.name',
    label: 'Project name',
    type: 'text',
    required: false,
    value: projectName,
    setter: (v: unknown) => setProjectName(v as string),
    enabled: projectFieldsVisible,
  });
  useRegisterFormField({
    id: 'pin-reg.project.address',
    label: 'Project address',
    type: 'text',
    required: false,
    value: projectAddress,
    setter: (v: unknown) => setProjectAddress(v as string),
    enabled: projectFieldsVisible,
  });
  useRegisterFormField({
    id: 'pin-reg.project.county',
    label: 'Project county',
    type: 'text',
    required: false,
    value: projectCounty,
    setter: (v: unknown) => setProjectCounty(v as string),
    enabled: projectFieldsVisible,
  });
  useRegisterFormField({
    id: 'pin-reg.project.subCounty',
    label: 'Project sub-county',
    type: 'text',
    required: false,
    value: projectSubCounty,
    setter: (v: unknown) => setProjectSubCounty(v as string),
    enabled: projectFieldsVisible,
  });
  useRegisterFormField({
    id: 'pin-reg.project.town',
    label: 'Project town',
    type: 'text',
    required: false,
    value: projectTown,
    setter: (v: unknown) => setProjectTown(v as string),
    enabled: projectFieldsVisible,
  });
  useRegisterFormField({
    id: 'pin-reg.project.sector',
    label: 'Project sector',
    type: 'text',
    required: false,
    value: projectSector,
    setter: (v: unknown) => setProjectSector(v as string),
    enabled: projectFieldsVisible,
  });
  useRegisterFormField({
    id: 'pin-reg.project.activity',
    label: 'Project activity',
    type: 'text',
    required: false,
    value: projectActivity,
    setter: (v: unknown) => setProjectActivity(v as string),
    enabled: projectFieldsVisible,
  });
  useRegisterFormField({
    id: 'pin-reg.project.description',
    label: 'Project description',
    type: 'text',
    required: false,
    value: projectDescription,
    setter: (v: unknown) => setProjectDescription(v as string),
    enabled: projectFieldsVisible,
  });
  useRegisterFormField({
    id: 'pin-reg.project.nationality',
    label: 'Business nationality',
    type: 'text',
    required: false,
    value: projectNationality,
    setter: (v: unknown) => setProjectNationality(v as string),
    enabled: projectFieldsVisible,
  });
  useRegisterFormField({
    id: 'pin-reg.project.amount',
    label: 'Investment amount (USD)',
    type: 'text',
    required: false,
    value: projectAmount,
    setter: (v: unknown) => setProjectAmount(v as string),
    enabled: projectFieldsVisible,
  });
  useRegisterFormField({
    id: 'pin-reg.project.localStaff',
    label: 'Local staff count',
    type: 'text',
    required: false,
    value: projectLocalStaff,
    setter: (v: unknown) => setProjectLocalStaff(v as string),
    enabled: projectFieldsVisible,
  });
  useRegisterFormField({
    id: 'pin-reg.project.foreignStaff',
    label: 'Foreign staff count',
    type: 'text',
    required: false,
    value: projectForeignStaff,
    setter: (v: unknown) => setProjectForeignStaff(v as string),
    enabled: projectFieldsVisible,
  });

  // --- Form Field Registry: top-level fields ---
  useRegisterFormField({
    id: 'pin-reg.hasProjectReference',
    label: 'Has project reference',
    type: 'radio',
    required: false,
    value: hasProjectReference,
    setter: (v: unknown) => setHasProjectReference(v as 'yes' | 'no' | null),
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
    enabled: showProjectReferenceSection,
  });
  useRegisterFormField({
    id: 'pin-reg.consent',
    label: 'Consent to share data',
    type: 'checkbox',
    required: false,
    value: consentChecked,
    setter: (v: unknown) => setConsentChecked(v as boolean),
    enabled: activeTab === 'send',
  });

  // --- Form Field Registry: director fields ---
  // Passport-extracted fields: only registered AFTER passport is uploaded and processed.
  // This prevents the copilot from asking for these manually — the passport OCR fills them.
  const passportProcessed = showDirectorForm && hasUploadedFile && !isProcessingPassport;
  useRegisterFormField({
    id: 'pin-reg.director.firstName',
    label: 'Director first name',
    type: 'text',
    required: true,
    value: currentDirector.firstName,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, firstName: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.middleName',
    label: 'Director middle name',
    type: 'text',
    required: false,
    value: currentDirector.middleName,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, middleName: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.lastName',
    label: 'Director last name',
    type: 'text',
    required: true,
    value: currentDirector.lastName,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, lastName: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.dateOfBirth',
    label: 'Director date of birth',
    type: 'date',
    required: false,
    value: currentDirector.dateOfBirth,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, dateOfBirth: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.nationality',
    label: 'Director nationality',
    type: 'text',
    required: false,
    value: currentDirector.nationality,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, nationality: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.gender',
    label: 'Director gender',
    type: 'radio',
    required: false,
    value: currentDirector.gender,
    setter: (v: unknown) =>
      setCurrentDirector((prev) => ({ ...prev, gender: v as 'male' | 'female' | '' })),
    options: [
      { value: 'male', label: 'Male' },
      { value: 'female', label: 'Female' },
    ],
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.passportNumber',
    label: 'Director passport number',
    type: 'text',
    required: false,
    value: currentDirector.passportNumber,
    setter: (v: unknown) =>
      setCurrentDirector((prev) => ({ ...prev, passportNumber: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.issuingCountry',
    label: 'Director issuing country',
    type: 'text',
    required: false,
    value: currentDirector.issuingCountry,
    setter: (v: unknown) =>
      setCurrentDirector((prev) => ({ ...prev, issuingCountry: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.issueDate',
    label: 'Director passport issue date',
    type: 'date',
    required: false,
    value: currentDirector.issueDate,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, issueDate: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.expiryDate',
    label: 'Director passport expiry date',
    type: 'date',
    required: false,
    value: currentDirector.expiryDate,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, expiryDate: v as string })),
    enabled: passportProcessed,
  });
  // Manual fields: only registered AFTER passport processing completes.
  // These are the fields the user must fill in themselves (not extracted from passport).
  useRegisterFormField({
    id: 'pin-reg.director.address',
    label: 'Director residential address',
    type: 'text',
    required: true,
    value: currentDirector.address,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, address: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.town',
    label: 'Director town',
    type: 'text',
    required: false,
    value: currentDirector.town,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, town: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.country',
    label: 'Director country',
    type: 'text',
    required: true,
    value: currentDirector.country,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, country: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.countryCode',
    label: 'Director country code',
    type: 'text',
    required: true,
    value: currentDirector.countryCode,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, countryCode: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.mobileNumber',
    label: 'Director mobile number',
    type: 'tel',
    required: true,
    value: currentDirector.mobileNumber,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, mobileNumber: v as string })),
    enabled: passportProcessed,
  });
  useRegisterFormField({
    id: 'pin-reg.director.email',
    label: 'Director email',
    type: 'email',
    required: true,
    value: currentDirector.email,
    setter: (v: unknown) => setCurrentDirector((prev) => ({ ...prev, email: v as string })),
    enabled: passportProcessed,
  });

  // Cleanup D-ID Agent Widget on mount
  useEffect(() => {
    // Remove any existing D-ID widget elements and scripts
    const existingWidget = document.querySelector('d-id-agent');
    if (existingWidget) {
      existingWidget.remove();
    }

    const existingScript = document.querySelector('script[data-name="did-agent"]');
    if (existingScript) {
      existingScript.remove();
    }
  }, []);

  const clearProjectFields = () => {
    setProjectName('');
    setProjectAddress('');
    setProjectCounty('');
    setProjectSubCounty('');
    setProjectTown('');
    setProjectSector('');
    setProjectActivity('');
    setProjectDescription('');
    setProjectNationality('');
    setProjectAmount('');
    setProjectLocalStaff('');
    setProjectForeignStaff('');
    setProjectDataQueried(false);
  };

  const handleProjectReferenceChange = (value: 'yes' | 'no') => {
    setHasProjectReference(value);

    // Clear validation error when user makes a selection
    setValidationErrors((prev) => {
      const newErrors = new Set(prev);
      newErrors.delete('projectReference');
      return newErrors;
    });

    // Clear project fields when switching to "No"
    if (value === 'no') {
      clearProjectFields();
    }
  };

  const handleQueryProjectData = async () => {
    // Start loading
    setIsQueryingProject(true);

    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Set mock data for the project
    setProjectName('Nairobi Tech Hub Development');
    setProjectAddress('Westlands Road, Enterprise Park');
    setProjectCounty('Nairobi');
    setProjectSubCounty('Westlands');
    setProjectTown('Nairobi');
    setProjectSector('ICT');
    setProjectActivity('Software');
    setProjectDescription(
      "A modern technology hub providing office space, innovation labs, and co-working facilities for tech startups and digital companies. The project aims to foster innovation and entrepreneurship in Kenya's growing ICT sector."
    );
    setProjectNationality('Foreign');
    setProjectAmount('5000000');
    setProjectLocalStaff('45');
    setProjectForeignStaff('8');

    // Mark that project data has been queried
    setProjectDataQueried(true);

    // Stop loading
    setIsQueryingProject(false);

    // Scroll to project information section
    setTimeout(() => {
      projectInfoRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 100);
  };

  const handleAddDirector = () => {
    setShowDirectorForm(true);
    setEditingDirectorId(null);
    setCurrentDirector({
      id: Date.now().toString(),
      firstName: '',
      middleName: '',
      lastName: '',
      dateOfBirth: '',
      nationality: '',
      gender: '',
      passportNumber: '',
      issuingCountry: '',
      issueDate: '',
      expiryDate: '',
      address: '',
      town: '',
      country: '',
      countryCode: '',
      mobileNumber: '',
      email: '',
      acknowledgementNumber: '',
      resultMessage: '',
      passportFile: null,
    });
    // Reset passport upload states
    setHasUploadedFile(false);
    setIsImageLoading(false);
    setIsProcessingPassport(false);
  };

  const handleEditDirector = (director: Director) => {
    setCurrentDirector(director);
    setEditingDirectorId(director.id);
    setShowDirectorForm(true);
  };

  const handleSaveDirector = () => {
    // Validate mandatory fields
    const errors = new Set<string>();

    // Email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!currentDirector.passportFile) errors.add('passportFile');
    if (!currentDirector.firstName.trim()) errors.add('firstName');
    if (!currentDirector.lastName.trim()) errors.add('lastName');
    if (!currentDirector.dateOfBirth) errors.add('dateOfBirth');
    if (!currentDirector.nationality) errors.add('nationality');
    if (!currentDirector.gender) errors.add('gender');
    if (!currentDirector.passportNumber.trim()) errors.add('passportNumber');
    if (!currentDirector.issuingCountry) errors.add('issuingCountry');
    if (!currentDirector.issueDate) errors.add('issueDate');
    if (!currentDirector.expiryDate) errors.add('expiryDate');
    if (!currentDirector.address.trim()) errors.add('address');
    if (!currentDirector.country) errors.add('country');
    if (!currentDirector.countryCode) errors.add('countryCode');
    if (!currentDirector.mobileNumber.trim()) errors.add('mobileNumber');
    if (!currentDirector.email.trim() || !emailRegex.test(currentDirector.email.trim()))
      errors.add('email');

    if (errors.size > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors(new Set());
    if (editingDirectorId) {
      setDirectors(directors.map((d) => (d.id === editingDirectorId ? currentDirector : d)));
    } else {
      setDirectors([...directors, currentDirector]);
    }
    setShowDirectorForm(false);
    setEditingDirectorId(null);
    setShowProjectReferenceSection(true);

    // Stay in the form tab - don't switch tabs
  };

  const handleValidateForm = () => {
    const errors = new Set<string>();

    // Validate that at least one director exists
    if (directors.length === 0) {
      alert('Please add at least one director before validating the form.');
      return;
    }

    // Validate project reference selection
    if (hasProjectReference === null) {
      errors.add('projectReference');
    }

    // Validate investment project information fields (only if the section is visible)
    if (hasProjectReference === 'no' || projectDataQueried) {
      if (!projectName.trim()) errors.add('projectName');
      if (!projectCounty) errors.add('projectCounty');
      if (!projectSubCounty) errors.add('projectSubCounty');
      if (!projectSector) errors.add('projectSector');
      if (!projectActivity) errors.add('projectActivity');
      if (!projectDescription.trim()) errors.add('projectDescription');
    }

    // If there are validation errors, show them and don't proceed
    if (errors.size > 0) {
      setValidationErrors(errors);
      // Scroll to the first error
      if (
        errors.has('projectReference') ||
        errors.has('projectName') ||
        errors.has('projectCounty') ||
        errors.has('projectSubCounty') ||
        errors.has('projectSector') ||
        errors.has('projectActivity') ||
        errors.has('projectDescription')
      ) {
        // Scroll to project info section if it exists
        projectInfoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    // All validations passed - switch to Send tab
    setValidationErrors(new Set());
    setActiveTab('send');
  };

  const handleCancelDirector = () => {
    setShowDirectorForm(false);
    setEditingDirectorId(null);
  };

  const handleDeleteDirector = (id: string) => {
    setDirectors(directors.filter((d) => d.id !== id));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCurrentDirector({ ...currentDirector, passportFile: file });
      setHasUploadedFile(true);
    }
  };

  const handleSimulateUpload = () => {
    // Simulate immediate file upload without opening file dialog
    const mockFile = new File(['passport content'], 'passport_scan.pdf', {
      type: 'application/pdf',
    });
    setCurrentDirector({ ...currentDirector, passportFile: mockFile });
    setHasUploadedFile(true);
    setIsImageLoading(true);
    setIsProcessingPassport(true);

    // Ensure spinner shows for at least 1 second
    setTimeout(() => {
      setIsImageLoading(false);
    }, 1000);

    // Simulate processing and auto-fill after 2.5 seconds
    setTimeout(() => {
      setCurrentDirector((prev) => ({
        ...prev,
        firstName: 'James',
        middleName: 'William',
        lastName: 'Anderson',
        dateOfBirth: '1965-02-05',
        nationality: 'USA',
        gender: 'male',
        passportNumber: 'E00009349',
        issuingCountry: 'USA',
        issueDate: '2020-07-10',
        expiryDate: '2030-07-09',
      }));
      setIsProcessingPassport(false);

      // Scroll to Personal details section after auto-fill
      setTimeout(() => {
        personalDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }, 2500);
  };

  const handleDeletePassport = () => {
    // Reset file upload state
    setHasUploadedFile(false);
    setIsProcessingPassport(false);
    setIsImageLoading(false);

    // Clear Personal details section only
    setCurrentDirector((prev) => ({
      ...prev,
      passportFile: null,
      firstName: '',
      middleName: '',
      lastName: '',
      dateOfBirth: '',
      nationality: '',
      gender: '',
      passportNumber: '',
      issuingCountry: '',
      issueDate: '',
      expiryDate: '',
    }));
  };

  // --- UI Action Registry ---
  const handleDeleteDirectorByIndex = useCallback(
    (params?: Record<string, unknown>) => {
      const index = Number(params?.index);
      if (isNaN(index) || index < 0 || index >= directors.length) return 'Invalid director index';
      handleDeleteDirector(directors[index].id);
      return `Deleted director at index ${index}`;
    },
    [directors, handleDeleteDirector]
  );

  const handleEditDirectorByIndex = useCallback(
    (params?: Record<string, unknown>) => {
      const index = Number(params?.index);
      if (isNaN(index) || index < 0 || index >= directors.length) return 'Invalid director index';
      handleEditDirector(directors[index]);
      return `Editing director at index ${index}`;
    },
    [directors, handleEditDirector]
  );

  const handleSetProjectReference = useCallback((params?: Record<string, unknown>) => {
    const value = params?.value as string;
    if (value !== 'yes' && value !== 'no') return 'Invalid value. Use "yes" or "no"';
    handleProjectReferenceChange(value);
    return `Set project reference to ${value}`;
  }, []);

  useRegisterUIAction(
    'pin-reg.addDirector',
    'Open the add director form to add a new foreign director',
    () => {
      handleAddDirector();
      return 'Director form opened. The form currently shows ONLY a required "Upload passport copy" field with a drag-and-drop area. The user must upload their certified passport first. The system will automatically validate the document and extract personal details (name, date of birth, nationality, passport number, etc.). Personal detail fields will appear only AFTER the passport is uploaded and processed. Tell the user to upload their passport to continue.';
    },
    { category: 'pin-registration' }
  );
  useRegisterUIAction(
    'pin-reg.saveDirector',
    'Save the current director form. Will fail if required fields are missing.',
    () => {
      const errorsBefore = validationErrors.size;
      handleSaveDirector();
      // If validation errors appeared, the save failed
      if (!showDirectorForm) {
        return 'Director saved successfully. The form now shows the saved director in a card. A new section appeared asking: "Is this request related to a project you have already started in our system?" with two options: "Yes - I already have a project reference number" or "No - I am starting a new project". The user must select one before continuing.';
      }
      return 'Save failed — some required fields are missing. Red error indicators are shown next to the empty required fields. Please ask the user to fill in all required fields before saving.';
    },
    { category: 'pin-registration' }
  );
  useRegisterUIAction(
    'pin-reg.cancelDirector',
    'Cancel director editing and close the form',
    handleCancelDirector,
    { category: 'pin-registration' }
  );
  useRegisterUIAction(
    'pin-reg.deleteDirector',
    'Delete a director by index',
    handleDeleteDirectorByIndex,
    {
      category: 'pin-registration',
      params: [{ name: 'index', description: 'Director index (0-based)', type: 'number' }],
    }
  );
  useRegisterUIAction(
    'pin-reg.editDirector',
    'Edit a director by index',
    handleEditDirectorByIndex,
    {
      category: 'pin-registration',
      params: [{ name: 'index', description: 'Director index (0-based)', type: 'number' }],
    }
  );
  useRegisterUIAction(
    'pin-reg.uploadPassport',
    'Upload and process a passport document (simulated)',
    () => {
      handleSimulateUpload();
      return 'Passport uploaded and processing started. The system is validating the document and extracting personal details. In a few seconds, the form will auto-fill personal details (first name, last name, date of birth, nationality, gender, passport number, issuing country, dates). Below the auto-filled fields, the user will need to manually fill in: residential address and contact information (country code, mobile number, email). Then click Save.';
    },
    { category: 'pin-registration' }
  );
  useRegisterUIAction(
    'pin-reg.deletePassport',
    'Delete the uploaded passport and clear extracted data',
    () => {
      handleDeletePassport();
      return 'Passport deleted. The form is back to showing the empty "Upload passport copy" drag-and-drop area. All previously extracted personal details have been cleared.';
    },
    { category: 'pin-registration' }
  );
  useRegisterTabSwitchAction(
    'pin-reg',
    ['form', 'send'] as const,
    (tab) => setActiveTab(tab as Tab),
    'pin-registration'
  );
  useRegisterUIAction(
    'pin-reg.setProjectReference',
    'Set whether the application is related to an existing project',
    handleSetProjectReference,
    {
      category: 'pin-registration',
      params: [{ name: 'value', description: 'yes or no', type: 'string' }],
    }
  );
  useRegisterUIAction(
    'pin-reg.queryProjectData',
    'Query project data from the reference number',
    handleQueryProjectData,
    { category: 'pin-registration' }
  );
  useRegisterUIAction(
    'pin-reg.validateForm',
    'Validate the form and proceed to the send tab',
    () => {
      handleValidateForm();
      if (activeTab === 'send') {
        return 'Form validated successfully. The view switched to the Send tab showing a consent checkbox: "You agree to share the data with Invest Kenya to process your application." and a "Validate and send" button. The user can submit their application.';
      }
      return 'Validation failed — some required fields are missing or no directors have been added. Red error indicators highlight the issues. The user needs to fix these before the form can be submitted.';
    },
    { category: 'pin-registration' }
  );
  useRegisterSubmitAction('pin-reg', {
    description:
      'Submit the application (click "Validate and send" button on the Send tab). Only works when the consent checkbox is checked.',
    guard: () => {
      if (activeTab !== 'send')
        return 'Cannot submit — the form is not on the Send tab yet. Use pin-reg.validateForm first to validate and switch to the Send tab.';
      if (!consentChecked)
        return 'Cannot submit — the consent checkbox is not checked. The user must agree to share data with Invest Kenya before submitting.';
      return null;
    },
    onSubmit: () => navigate('/dashboard'),
    category: 'pin-registration',
  });

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F2F3FA' }}>
      {/* Page Title */}
      <div className="border-b border-neutral-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <h4 className="!text-2xl">Tax registration for foreigners</h4>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-6 pt-[12px] pr-[24px] pb-[0px] pl-[24px]">
          <div className="flex gap-8">
            <button
              onClick={() => setActiveTab('form')}
              className={`pb-3 px-1 border-b-2 transition-colors font-semibold ${
                activeTab === 'form'
                  ? 'border-kenya-red-500 text-kenya-red-600'
                  : 'border-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Form
            </button>
            <button
              onClick={() => setActiveTab('send')}
              className={`pb-3 px-1 border-b-2 transition-colors font-semibold ${
                activeTab === 'send'
                  ? 'border-kenya-red-500 text-kenya-red-600'
                  : 'border-transparent text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8 pb-64">
        <div className="grid lg:grid-cols-12 gap-8">
          {/* Main Form Area */}
          <main className="lg:col-span-8">
            {activeTab === 'form' && (
              <>
                {/* Directors Details Section */}
                <div
                  className="rounded-2xl border-2 border-white mb-8"
                  style={{ backgroundColor: '#F9F9FC' }}
                >
                  <div className="border-b border-neutral-200 px-6 py-4">
                    <h5 className="text-sm">Directors details</h5>
                    <p className="text-xs text-neutral-600 mt-1">
                      Apply for one or more foreign directors. Each director will receive their own
                      KRA PIN.
                    </p>
                  </div>

                  <div className="p-6">
                    {directors.length === 0 && !showDirectorForm ? (
                      <div className="text-center py-12">
                        <div className="mb-4 flex justify-center">
                          <FileSearch className="w-16 h-16 text-neutral-400" strokeWidth={1} />
                        </div>
                        <p className="text-neutral-600 mb-2 font-bold">Your list is empty</p>
                        <p className="text-sm text-neutral-500 mb-6">
                          Start adding and editing directors
                        </p>
                        <button
                          onClick={handleAddDirector}
                          className="px-6 py-2.5 bg-kenya-red-500 hover:bg-kenya-red-600 text-white rounded-full transition-colors inline-flex items-center gap-2 text-sm"
                        >
                          <Plus className="w-4 h-4" />
                          Add
                        </button>
                      </div>
                    ) : null}

                    {/* Directors List */}
                    {directors.length > 0 && !showDirectorForm && (
                      <div className="space-y-4 mb-6">
                        {directors.map((director) => (
                          <div
                            key={director.id}
                            className="border border-neutral-200 rounded-lg p-4"
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <h6 className="mb-1">
                                  {director.firstName} {director.middleName} {director.lastName}
                                </h6>
                                <p className="text-sm text-neutral-600">
                                  Passport: {director.passportNumber} |{' '}
                                  <span className="inline-flex items-center gap-1.5">
                                    {director.nationality === 'USA' && (
                                      <span className="text-base">🇺🇸</span>
                                    )}
                                    {director.nationality}
                                  </span>{' '}
                                  | Email: {director.email}
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleEditDirector(director)}
                                  className="px-4 py-2 text-sm border border-neutral-300 rounded-full hover:bg-neutral-50"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteDirector(director.id)}
                                  className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-full hover:bg-red-50"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        <button
                          onClick={handleAddDirector}
                          className="px-6 py-2.5 bg-kenya-red-500 hover:bg-kenya-red-600 text-white rounded-full transition-colors inline-flex items-center gap-2 text-sm"
                        >
                          <Plus className="w-4 h-4" />
                          Add another director
                        </button>
                      </div>
                    )}

                    {/* Director Form */}
                    {showDirectorForm && (
                      <div className="space-y-8">
                        {/* Upload Section */}
                        <div>
                          <div className="mb-6 p-3 rounded-lg bg-green-50 border-2 border-white flex items-start gap-2">
                            <span className="text-neutral-600 flex-shrink-0 px-[0px] py-[1px]">
                              <CircleCheck className="w-5 h-5" />
                            </span>
                            <p className="text-neutral-600 !text-[14px] text-[14px]">
                              <strong>Automatic document validation:</strong> The passport will be
                              validated and key details extracted automatically. You can review and
                              edit before saving.
                            </p>
                          </div>

                          <label className="block text-sm mb-2">
                            Upload passport copy <span className="text-red-500">*</span>
                          </label>

                          {!hasUploadedFile ? (
                            <>
                              <div
                                onClick={handleSimulateUpload}
                                className={`border-2 border-dashed rounded-lg p-8 hover:border-neutral-400 transition-colors cursor-pointer ${
                                  validationErrors.has('passportFile')
                                    ? 'border-red-500'
                                    : 'border-neutral-300'
                                }`}
                              >
                                <div className="flex flex-col items-center justify-center gap-3">
                                  <Upload className="w-6 h-6 text-neutral-400" />
                                  <p className="text-neutral-700 text-center">
                                    Drop file to attach or{' '}
                                    <span className="text-kenya-red-500">Browse</span>
                                  </p>
                                </div>
                              </div>
                              {validationErrors.has('passportFile') && (
                                <span className="text-red-500 text-xs mt-1 block">Required</span>
                              )}
                            </>
                          ) : (
                            <div className="grid md:grid-cols-3 gap-4">
                              <div className="md:col-span-2">
                                <div className="border border-neutral-300 rounded-lg bg-white overflow-hidden">
                                  {/* Passport Image Preview */}
                                  <div className="relative min-h-[200px]">
                                    {/* Show spinner while image is loading */}
                                    {isImageLoading && (
                                      <div className="absolute inset-0 flex items-center justify-center bg-neutral-50">
                                        <Loader2 className="w-8 h-8 text-kenya-red-500 animate-spin" />
                                      </div>
                                    )}
                                    <img
                                      src={uploadedPassportImage}
                                      alt="Uploaded passport"
                                      className={`w-full h-auto ${isImageLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
                                    />
                                    <button
                                      onClick={handleDeletePassport}
                                      className="absolute top-2 right-2 p-1.5 bg-white hover:bg-neutral-100 rounded-full transition-colors shadow-md"
                                    >
                                      <X className="w-5 h-5 text-neutral-600 hover:text-neutral-900" />
                                    </button>
                                  </div>

                                  {/* Processing stripe */}
                                  {isProcessingPassport && (
                                    <div className="flex items-center justify-center gap-3 p-4 bg-green-50 border-t border-green-200">
                                      <Loader2 className="w-5 h-5 text-green-600 animate-spin" />
                                      <span className="text-sm text-green-900">
                                        Processing passport data...
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Personal Details - Only show after upload */}
                        {hasUploadedFile && (
                          <>
                            <div ref={personalDetailsRef}>
                              <h6 className="mb-4">Personal details</h6>
                              <div className="grid md:grid-cols-3 gap-4">
                                <div>
                                  <label className="block text-sm mb-1">
                                    First name <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="text"
                                    value={currentDirector.firstName}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        firstName: e.target.value,
                                      })
                                    }
                                    className={`w-full px-3 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                      validationErrors.has('firstName')
                                        ? 'border-red-500'
                                        : 'border-neutral-300'
                                    }`}
                                  />
                                  {validationErrors.has('firstName') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-sm mb-1">Middle name</label>
                                  <input
                                    type="text"
                                    value={currentDirector.middleName}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        middleName: e.target.value,
                                      })
                                    }
                                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded focus:outline-none focus:border-kenya-red-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm mb-1">
                                    Last name <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="text"
                                    value={currentDirector.lastName}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        lastName: e.target.value,
                                      })
                                    }
                                    className={`w-full px-3 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                      validationErrors.has('lastName')
                                        ? 'border-red-500'
                                        : 'border-neutral-300'
                                    }`}
                                  />
                                  {validationErrors.has('lastName') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-sm mb-1">
                                    Date of birth <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="date"
                                    value={currentDirector.dateOfBirth}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        dateOfBirth: e.target.value,
                                      })
                                    }
                                    className={`w-full px-3 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                      validationErrors.has('dateOfBirth')
                                        ? 'border-red-500'
                                        : 'border-neutral-300'
                                    }`}
                                  />
                                  {validationErrors.has('dateOfBirth') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-sm mb-1">
                                    Nationality <span className="text-red-500">*</span>
                                  </label>
                                  <div className="relative">
                                    {currentDirector.nationality === 'USA' && (
                                      <span
                                        className="absolute left-3 top-1/2 -translate-y-1/2 text-xl pointer-events-none"
                                        aria-hidden="true"
                                      >
                                        🇺🇸
                                      </span>
                                    )}
                                    <select
                                      value={currentDirector.nationality}
                                      onChange={(e) =>
                                        setCurrentDirector({
                                          ...currentDirector,
                                          nationality: e.target.value,
                                        })
                                      }
                                      className={`w-full py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                        validationErrors.has('nationality')
                                          ? 'border-red-500'
                                          : 'border-neutral-300'
                                      } ${
                                        currentDirector.nationality === 'USA'
                                          ? 'pl-12 pr-16'
                                          : 'pl-3 pr-16'
                                      }`}
                                    >
                                      <option value="">Select</option>
                                      <option value="USA">United States</option>
                                      <option value="UK">United Kingdom</option>
                                      <option value="China">China</option>
                                      <option value="India">India</option>
                                      <option value="Germany">Germany</option>
                                    </select>
                                  </div>
                                  {validationErrors.has('nationality') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                                <div className="md:col-span-3">
                                  <label className="block text-sm mb-2">
                                    Gender <span className="text-red-500">*</span>
                                  </label>
                                  <div className="flex gap-6">
                                    <label className="flex items-center gap-2">
                                      <input
                                        type="radio"
                                        name="gender"
                                        value="male"
                                        checked={currentDirector.gender === 'male'}
                                        onChange={(e) =>
                                          setCurrentDirector({ ...currentDirector, gender: 'male' })
                                        }
                                        className="w-4 h-4 accent-kenya-red-500"
                                      />
                                      <span className="text-sm">Male</span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                      <input
                                        type="radio"
                                        name="gender"
                                        value="female"
                                        checked={currentDirector.gender === 'female'}
                                        onChange={(e) =>
                                          setCurrentDirector({
                                            ...currentDirector,
                                            gender: 'female',
                                          })
                                        }
                                        className="w-4 h-4 accent-kenya-red-500"
                                      />
                                      <span className="text-sm">Female</span>
                                    </label>
                                  </div>
                                  {validationErrors.has('gender') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-sm mb-1">
                                    Passport number <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="text"
                                    value={currentDirector.passportNumber}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        passportNumber: e.target.value,
                                      })
                                    }
                                    className={`w-full px-3 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                      validationErrors.has('passportNumber')
                                        ? 'border-red-500'
                                        : 'border-neutral-300'
                                    }`}
                                  />
                                  {validationErrors.has('passportNumber') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-sm mb-1">
                                    Issuing country <span className="text-red-500">*</span>
                                  </label>
                                  <div className="relative">
                                    {currentDirector.issuingCountry === 'USA' && (
                                      <span
                                        className="absolute left-3 top-1/2 -translate-y-1/2 text-xl pointer-events-none"
                                        aria-hidden="true"
                                      >
                                        🇺🇸
                                      </span>
                                    )}
                                    <select
                                      value={currentDirector.issuingCountry}
                                      onChange={(e) =>
                                        setCurrentDirector({
                                          ...currentDirector,
                                          issuingCountry: e.target.value,
                                        })
                                      }
                                      className={`w-full py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                        validationErrors.has('issuingCountry')
                                          ? 'border-red-500'
                                          : 'border-neutral-300'
                                      } ${
                                        currentDirector.issuingCountry === 'USA'
                                          ? 'pl-12 pr-16'
                                          : 'pl-3 pr-16'
                                      }`}
                                    >
                                      <option value="">Select</option>
                                      <option value="USA">United States</option>
                                      <option value="UK">United Kingdom</option>
                                      <option value="China">China</option>
                                      <option value="India">India</option>
                                      <option value="Germany">Germany</option>
                                    </select>
                                  </div>
                                  {validationErrors.has('issuingCountry') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-sm mb-1">
                                    Issue date <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="date"
                                    value={currentDirector.issueDate}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        issueDate: e.target.value,
                                      })
                                    }
                                    className={`w-full px-3 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                      validationErrors.has('issueDate')
                                        ? 'border-red-500'
                                        : 'border-neutral-300'
                                    }`}
                                  />
                                  {validationErrors.has('issueDate') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-sm mb-1">
                                    Expiry date <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="date"
                                    value={currentDirector.expiryDate}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        expiryDate: e.target.value,
                                      })
                                    }
                                    className={`w-full px-3 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                      validationErrors.has('expiryDate')
                                        ? 'border-red-500'
                                        : 'border-neutral-300'
                                    }`}
                                  />
                                  {validationErrors.has('expiryDate') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Residential Address */}
                            <div>
                              <h6 className="mb-4">Residential address</h6>
                              <div className="grid md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                  <label className="block text-sm mb-1">
                                    Address <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="text"
                                    value={currentDirector.address}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        address: e.target.value,
                                      })
                                    }
                                    className={`w-full px-3 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                      validationErrors.has('address')
                                        ? 'border-red-500'
                                        : 'border-neutral-300'
                                    }`}
                                  />
                                  {validationErrors.has('address') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-sm mb-1">Town</label>
                                  <input
                                    type="text"
                                    value={currentDirector.town}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        town: e.target.value,
                                      })
                                    }
                                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded focus:outline-none focus:border-kenya-red-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm mb-1">
                                    Country <span className="text-red-500">*</span>
                                  </label>
                                  <select
                                    value={currentDirector.country}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        country: e.target.value,
                                      })
                                    }
                                    className={`w-full pl-3 pr-16 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                      validationErrors.has('country')
                                        ? 'border-red-500'
                                        : 'border-neutral-300'
                                    }`}
                                  >
                                    <option value="">Select</option>
                                    <option value="Kenya">Kenya</option>
                                    <option value="USA">United States</option>
                                    <option value="UK">United Kingdom</option>
                                  </select>
                                  {validationErrors.has('country') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Contact */}
                            <div>
                              <h6 className="mb-4">Contact</h6>
                              <div className="grid md:grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm mb-1">
                                    Country code <span className="text-red-500">*</span>
                                  </label>
                                  <select
                                    value={currentDirector.countryCode}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        countryCode: e.target.value,
                                      })
                                    }
                                    className={`w-full pl-3 pr-16 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                      validationErrors.has('countryCode')
                                        ? 'border-red-500'
                                        : 'border-neutral-300'
                                    }`}
                                  >
                                    <option value="">Select</option>
                                    <option value="+254">+254 (Kenya)</option>
                                    <option value="+1">+1 (USA/Canada)</option>
                                    <option value="+44">+44 (UK)</option>
                                    <option value="+86">+86 (China)</option>
                                  </select>
                                  {validationErrors.has('countryCode') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-sm mb-1">
                                    Primary Mobile Number <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="tel"
                                    value={currentDirector.mobileNumber}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        mobileNumber: e.target.value,
                                      })
                                    }
                                    className={`w-full px-3 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                      validationErrors.has('mobileNumber')
                                        ? 'border-red-500'
                                        : 'border-neutral-300'
                                    }`}
                                  />
                                  {validationErrors.has('mobileNumber') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                                <div className="md:col-span-2">
                                  <label className="block text-sm mb-1">
                                    Main email address <span className="text-red-500">*</span>
                                  </label>
                                  <input
                                    type="email"
                                    value={currentDirector.email}
                                    onChange={(e) =>
                                      setCurrentDirector({
                                        ...currentDirector,
                                        email: e.target.value,
                                      })
                                    }
                                    className={`w-full px-3 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                      validationErrors.has('email')
                                        ? 'border-red-500'
                                        : 'border-neutral-300'
                                    }`}
                                  />
                                  {validationErrors.has('email') && (
                                    <span className="text-red-500 text-xs mt-1 block">
                                      Required
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-3 pt-4 border-t border-neutral-200">
                              <button
                                onClick={handleSaveDirector}
                                className="px-6 py-2.5 border border-kenya-red-500 hover:border-kenya-red-600 text-kenya-red-500 hover:text-kenya-red-600 rounded-full transition-colors text-sm"
                              >
                                Save
                              </button>
                              <button
                                onClick={handleCancelDirector}
                                className="px-6 py-2.5 text-neutral-600 hover:text-neutral-900 transition-colors text-sm"
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Project Reference Section */}
                {showProjectReferenceSection && (
                  <div
                    className={`rounded-2xl border-2 mb-8 p-6 ${validationErrors.has('projectReference') ? 'border-red-500' : 'border-white'}`}
                    style={{ backgroundColor: '#F9F9FC' }}
                  >
                    <p className="mb-4">
                      Is this request related to a project that you have already started in our
                      system? <span className="text-red-500">*</span>
                    </p>

                    <div className="space-y-3 mb-4">
                      <label
                        className={`flex items-start gap-4 p-4 border-2 rounded-2xl cursor-pointer transition-all bg-white ${
                          hasProjectReference === 'yes'
                            ? 'border-neutral-800'
                            : 'border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="projectReference"
                          checked={hasProjectReference === 'yes'}
                          onChange={() => handleProjectReferenceChange('yes')}
                          className="sr-only"
                        />
                        <CircleCheck
                          className={`w-5 h-5 mt-0.5 flex-shrink-0 ${hasProjectReference === 'yes' ? 'text-neutral-300' : 'text-neutral-300'}`}
                          style={hasProjectReference === 'yes' ? { color: '#22866c' } : {}}
                        />
                        <div className="flex-1">
                          <div
                            className={`font-medium !text-[16px] mb-0.5 ${hasProjectReference === 'yes' ? 'text-neutral-900' : 'text-neutral-600'}`}
                          >
                            Yes – I already have a project reference number
                          </div>
                          <div className="text-neutral-600 !text-[14px]">
                            Select this if you have an existing project in our system
                          </div>
                        </div>
                      </label>
                      <label
                        className={`flex items-start gap-4 p-4 border-2 rounded-2xl cursor-pointer transition-all bg-white ${
                          hasProjectReference === 'no'
                            ? 'border-neutral-800'
                            : 'border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="projectReference"
                          checked={hasProjectReference === 'no'}
                          onChange={() => handleProjectReferenceChange('no')}
                          className="sr-only"
                        />
                        <Plus
                          className={`w-5 h-5 mt-0.5 flex-shrink-0 ${hasProjectReference === 'no' ? 'text-neutral-300' : 'text-neutral-300'}`}
                          style={hasProjectReference === 'no' ? { color: '#22866c' } : {}}
                        />
                        <div className="flex-1">
                          <div
                            className={`font-medium !text-[16px] mb-0.5 ${hasProjectReference === 'no' ? 'text-neutral-900' : 'text-neutral-600'}`}
                          >
                            No – I am starting a new project
                          </div>
                          <div className="text-neutral-600 !text-[14px]">
                            Select this if this is your first project submission
                          </div>
                        </div>
                      </label>
                    </div>

                    {validationErrors.has('projectReference') && (
                      <p className="text-red-500 text-sm mt-2">Please select an option</p>
                    )}

                    {hasProjectReference === 'yes' && (
                      <div className="flex gap-3 mt-4">
                        <input
                          type="text"
                          placeholder="Enter your project reference number"
                          value={projectReference}
                          onChange={(e) => setProjectReference(e.target.value)}
                          className="flex-1 px-3 py-2 bg-white border border-neutral-300 rounded focus:outline-none focus:border-kenya-red-500"
                        />
                        <button
                          onClick={handleQueryProjectData}
                          disabled={isQueryingProject}
                          className="px-6 py-2 bg-white border border-kenya-red-500 text-kenya-red-500 hover:bg-kenya-red-50 rounded-full transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {isQueryingProject && <Loader2 className="w-4 h-4 animate-spin" />}
                          Query project data
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Investment Project Information */}
                {(hasProjectReference === 'no' || projectDataQueried) && (
                  <div
                    ref={projectInfoRef}
                    className="rounded-2xl border-2 border-white mb-8"
                    style={{ backgroundColor: '#F9F9FC' }}
                  >
                    <div className="border-b border-neutral-200 px-6 py-4">
                      <h5 className="text-sm">Information on your investment project</h5>
                    </div>

                    <div className="p-6 space-y-6">
                      {/* Project Details */}
                      <div>
                        <h6 className="mb-4">Name your project</h6>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm mb-1">
                              Name <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={projectName}
                              onChange={(e) => setProjectName(e.target.value)}
                              className={`w-full px-3 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                validationErrors.has('projectName')
                                  ? 'border-red-500'
                                  : 'border-neutral-300'
                              }`}
                              placeholder="e.g., Nairobi Tech Hub Development"
                            />
                            {validationErrors.has('projectName') && (
                              <span className="text-red-500 text-xs mt-1 block">Required</span>
                            )}
                          </div>
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <p className="text-xs text-neutral-700">
                              <strong>Provide a short reference name for your project.</strong>
                              <br />
                              If you do not have an official project name, you can create one using
                              your planned company name and the planned activity or location (e.g.
                              "Tech Export Project – Kenya").
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Location */}
                      <div>
                        <h6 className="mb-4">Planned location of your project in Kenya</h6>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <label className="block text-sm mb-1">Address</label>
                            <input
                              type="text"
                              value={projectAddress}
                              onChange={(e) => setProjectAddress(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-neutral-300 rounded focus:outline-none focus:border-kenya-red-500"
                            />
                          </div>
                          <div>
                            <label className="block text-sm mb-1">
                              County <span className="text-red-500">*</span>
                            </label>
                            <select
                              value={projectCounty}
                              onChange={(e) => setProjectCounty(e.target.value)}
                              className={`w-full pl-3 pr-16 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                validationErrors.has('projectCounty')
                                  ? 'border-red-500'
                                  : 'border-neutral-300'
                              }`}
                            >
                              <option value="">Select</option>
                              <option value="Nairobi">Nairobi</option>
                              <option value="Mombasa">Mombasa</option>
                              <option value="Kisumu">Kisumu</option>
                            </select>
                            {validationErrors.has('projectCounty') && (
                              <span className="text-red-500 text-xs mt-1 block">Required</span>
                            )}
                          </div>
                          <div>
                            <label className="block text-sm mb-1">
                              Sub county <span className="text-red-500">*</span>
                            </label>
                            <select
                              value={projectSubCounty}
                              onChange={(e) => setProjectSubCounty(e.target.value)}
                              className={`w-full pl-3 pr-16 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                validationErrors.has('projectSubCounty')
                                  ? 'border-red-500'
                                  : 'border-neutral-300'
                              }`}
                            >
                              <option value="">Select</option>
                              <option value="Westlands">Westlands</option>
                              <option value="Kasarani">Kasarani</option>
                            </select>
                            {validationErrors.has('projectSubCounty') && (
                              <span className="text-red-500 text-xs mt-1 block">Required</span>
                            )}
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm mb-1">Town</label>
                            <input
                              type="text"
                              value={projectTown}
                              onChange={(e) => setProjectTown(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-neutral-300 rounded focus:outline-none focus:border-kenya-red-500"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Planned Activity */}
                      <div>
                        <h6 className="mb-4">Planned activity</h6>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm mb-1">
                              Sector <span className="text-red-500">*</span>
                            </label>
                            <select
                              value={projectSector}
                              onChange={(e) => setProjectSector(e.target.value)}
                              className={`w-full pl-3 pr-16 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                validationErrors.has('projectSector')
                                  ? 'border-red-500'
                                  : 'border-neutral-300'
                              }`}
                            >
                              <option value="">Select</option>
                              <option value="ICT">ICT & Technology</option>
                              <option value="Manufacturing">Manufacturing</option>
                              <option value="Agriculture">Agriculture</option>
                              <option value="Tourism">Tourism</option>
                            </select>
                            {validationErrors.has('projectSector') && (
                              <span className="text-red-500 text-xs mt-1 block">Required</span>
                            )}
                          </div>
                          <div>
                            <label className="block text-sm mb-1">
                              Activity <span className="text-red-500">*</span>
                            </label>
                            <select
                              value={projectActivity}
                              onChange={(e) => setProjectActivity(e.target.value)}
                              className={`w-full pl-3 pr-16 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                validationErrors.has('projectActivity')
                                  ? 'border-red-500'
                                  : 'border-neutral-300'
                              }`}
                            >
                              <option value="">Select</option>
                              <option value="Software">Software Development</option>
                              <option value="Manufacturing">Product Manufacturing</option>
                            </select>
                            {validationErrors.has('projectActivity') && (
                              <span className="text-red-500 text-xs mt-1 block">Required</span>
                            )}
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-sm mb-1">
                              Brief presentation of your project and main activities{' '}
                              <span className="text-red-500">*</span>
                            </label>
                            <textarea
                              rows={4}
                              value={projectDescription}
                              onChange={(e) => setProjectDescription(e.target.value)}
                              className={`w-full px-3 py-2 bg-white border rounded focus:outline-none focus:border-kenya-red-500 ${
                                validationErrors.has('projectDescription')
                                  ? 'border-red-500'
                                  : 'border-neutral-300'
                              }`}
                              placeholder="Describe your project..."
                            />
                            {validationErrors.has('projectDescription') && (
                              <span className="text-red-500 text-xs mt-1 block">Required</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Investment Amount */}
                      <div>
                        <h6 className="mb-4">Planned investment amount</h6>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm mb-1">
                              Nationality of the business <span className="text-red-500">*</span>
                            </label>
                            <select
                              value={projectNationality}
                              onChange={(e) => setProjectNationality(e.target.value)}
                              className="w-full pl-3 pr-16 py-2 bg-white border border-neutral-300 rounded focus:outline-none focus:border-kenya-red-500"
                            >
                              <option value="">Select</option>
                              <option value="Foreign">Foreign</option>
                              <option value="Local">Local</option>
                              <option value="Joint">Joint Venture</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm mb-1">
                              Total amount (USD) <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="number"
                              value={projectAmount}
                              onChange={(e) => setProjectAmount(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-neutral-300 rounded focus:outline-none focus:border-kenya-red-500"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Employment */}
                      <div>
                        <h6 className="mb-4">Employment</h6>
                        <div className="grid md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm mb-1">Local staff</label>
                            <input
                              type="number"
                              value={projectLocalStaff}
                              onChange={(e) => setProjectLocalStaff(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-neutral-300 rounded focus:outline-none focus:border-kenya-red-500"
                              placeholder="0"
                            />
                          </div>
                          <div>
                            <label className="block text-sm mb-1">Foreign staff</label>
                            <input
                              type="number"
                              value={projectForeignStaff}
                              onChange={(e) => setProjectForeignStaff(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-neutral-300 rounded focus:outline-none focus:border-kenya-red-500"
                              placeholder="0"
                            />
                          </div>
                          <div>
                            <label className="block text-sm mb-1">Total</label>
                            <input
                              type="number"
                              className="w-full px-3 py-2 border border-neutral-300 rounded bg-neutral-50"
                              value={
                                (Number(projectLocalStaff) || 0) +
                                (Number(projectForeignStaff) || 0)
                              }
                              readOnly
                              disabled
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Validation Button */}
                {(hasProjectReference === 'no' || projectDataQueried) && (
                  <div className="mb-8">
                    <div className="flex justify-end">
                      <button
                        onClick={handleValidateForm}
                        className="px-8 py-3 bg-kenya-red-500 hover:bg-kenya-red-600 text-white rounded-full transition-colors inline-flex items-center gap-2"
                      >
                        Validate the form
                        <ArrowUpRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Send Tab Content */}
            {activeTab === 'send' && (
              <div className="space-y-6">
                <div
                  className="rounded-2xl border-2 border-white p-6"
                  style={{ backgroundColor: '#F9F9FC' }}
                >
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={consentChecked}
                      onChange={(e) => setConsentChecked(e.target.checked)}
                      className="mt-1 w-4 h-4 accent-kenya-red-500"
                    />
                    <span className="text-sm pt-[2px] pr-[0px] pb-[0px] pl-[0px]">
                      You agree to share the data with Invest Kenya to process your application.
                    </span>
                  </label>
                </div>

                <div className="flex justify-center pt-8">
                  <button
                    onClick={() => navigate('/dashboard')}
                    disabled={!consentChecked}
                    className={`px-8 py-3 rounded-full transition-colors inline-flex items-center gap-2 ${
                      consentChecked
                        ? 'bg-kenya-red-500 hover:bg-kenya-red-600 text-white'
                        : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                    }`}
                  >
                    Validate and send
                    <ArrowUpRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </main>

          {/* Right Sidebar - Important Information (only on form tab) */}
          {activeTab === 'form' && (
            <aside className="lg:col-span-4">
              <div className="bg-white border border-neutral-200 rounded-2xl p-6 sticky top-6">
                <h5 className="text-[15px] mb-6">Important information</h5>

                <div className="space-y-6">
                  {/* How to check application status */}
                  <div>
                    <div className="flex items-start gap-2 mb-2">
                      <Paperclip className="w-4 h-4 mt-0.5 flex-shrink-0 text-kenya-red-500" />
                      <h6 className="!text-[14px] font-medium">
                        How to check your application status
                      </h6>
                    </div>
                    <p className="text-neutral-600 mb-2 ml-6 !text-[14px]">
                      You will receive email notifications whenever there is a change in your
                      application status. You can also check the status at any time on the Dashboard
                      under “My applications”
                    </p>
                  </div>

                  {/* How to find acknowledgement receipt */}
                  <div>
                    <div className="flex items-start gap-2 mb-2">
                      <Send className="w-4 h-4 mt-0.5 flex-shrink-0 text-kenya-red-500" />
                      <h6 className="!text-[14px] font-medium">
                        How to find my application acknowledgement receipt(s)
                      </h6>
                    </div>
                    <p className="text-neutral-600 ml-6 !text-[14px]">
                      Check your email's inbox folder. Alternatively, check your spam folder
                    </p>
                  </div>

                  {/* How to contact Department */}
                  <div>
                    <div className="flex items-start gap-2 mb-2">
                      <MessageCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-kenya-red-500" />
                      <h6 className="!text-[14px] font-medium">
                        How to contact Kenya Revenue Authority
                      </h6>
                    </div>
                    <p className="text-neutral-600 ml-6 !text-[14px]">
                      For any questions, email us at pinregistration@kra.go.ke or contact us via our
                      live chat.
                    </p>
                  </div>

                  {/* Processing time */}
                  <div>
                    <div className="flex items-start gap-2 mb-2">
                      <Hourglass className="w-4 h-4 mt-0.5 flex-shrink-0 text-kenya-red-500" />
                      <h6 className="!text-[14px] font-medium">How long does processing take?</h6>
                    </div>
                    <p className="text-neutral-600 ml-6 !text-[14px]">
                      Processing typically takes 5-7 business days for KRA PIN applications, but in
                      some cases it may take longer.
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
