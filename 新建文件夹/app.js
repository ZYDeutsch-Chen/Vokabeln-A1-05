// 强制刷新缓存机制
(function() {
    const CURRENT_VERSION = '1.0.1';  // 版本更新以清除缓存
    const VERSION_STORAGE_KEY = 'a1_verb_version';

    const storedVersion = sessionStorage.getItem(VERSION_STORAGE_KEY);
    if (storedVersion && storedVersion !== CURRENT_VERSION) {
        sessionStorage.clear();
        localStorage.clear();  // 清除localStorage缓存
        if (window.location.protocol === 'file:') {
            const separator = window.location.href.includes('?') ? '&' : '?';
            window.location.href = window.location.href.split('?')[0] + separator + '_v=' + CURRENT_VERSION + '&_t=' + Date.now();
        } else {
            window.location.reload(true);
        }
        return;
    }

    sessionStorage.setItem(VERSION_STORAGE_KEY, CURRENT_VERSION);

    if (window.location.protocol === 'file:') {
        const currentUrl = window.location.href;
        if (!currentUrl.includes('_v=')) {
            const separator = currentUrl.includes('?') ? '&' : '?';
            const newUrl = currentUrl.split('?')[0] + separator + '_v=' + CURRENT_VERSION;
            window.history.replaceState({}, '', newUrl);
        }
    }
})();

// ==================== 核心数据结构 ====================

const IS_DEV = window.location.hostname === 'localhost' || 
               window.location.hostname === '127.0.0.1' || 
               window.location.protocol === 'file:';

const log = IS_DEV ? console.log.bind(console) : () => {};
const warn = IS_DEV ? console.warn.bind(console) : () => {};
const error = IS_DEV ? console.error.bind(console) : () => {};

// 用户配置
let userConfig = {
    userType: null,
    ability: null,
    setupCompleted: false
};

// 主题排序配置（动词主题）
const themeOrder = {
    adult: [
        '旅行交通', '饮食消费', '居住卫生', '学习爱好', '社交情感', '其他'
    ],
    teenager: [
        '旅行交通', '饮食消费', '居住卫生', '学习爱好', '社交情感', '其他'
    ]
};

// 测试规则配置
const testRules = {
    normal: {
        test1: {
            passRate: 0.8,
            required: true,
            unlockTest2: false
        },
        test2: {
            passRate: null,
            required: false,
            hidden: true
        }
    },
    good: {
        test1: {
            passRate: 0.8,
            required: true,
            unlockTest2: true,
            unlockThreshold: 0.9
        },
        test2: {
            passRate: null,
            required: false,
            hidden: false
        }
    },
    excellent: {
        test1: {
            passRate: 0.9,
            required: true,
            unlockTest2: false
        },
        test2: {
            passRate: 0.7,
            required: true,
            hidden: false
        }
    }
};

// 学习进度
let learningProgress = {
    currentThemeIndex: 0,
    currentMode: 'learning',
    currentTestType: null,
    currentTheme: null,
    themes: {},
    carryOverMistakes: []
};

function ensureCarryOverStorage() {
    if (!learningProgress.carryOverMistakes) {
        learningProgress.carryOverMistakes = [];
    }
    return learningProgress.carryOverMistakes;
}

function getCarryOverMistakes() {
    return ensureCarryOverStorage();
}

function addCarryOverMistake(verb) {
    if (!verb || !verb.infinitive) return;
    const carryOverList = ensureCarryOverStorage();
    const exists = carryOverList.some(item => item.infinitive === verb.infinitive);
    if (exists) {
        return;
    }
    carryOverList.push({
        infinitive: verb.infinitive,
        pres3: verb.pres3,
        pii: verb.pii,
        example: verb.example,
        meaning: verb.meaning,
        valence: verb.valence,
        category: verb.category,
        carryOver: true,
        originTheme: learningProgress.currentTheme || verb.category
    });
}

function removeCarryOverMistake(infinitive) {
    if (!infinitive) return;
    const carryOverList = ensureCarryOverStorage();
    const nextList = carryOverList.filter(item => item.infinitive !== infinitive);
    learningProgress.carryOverMistakes = nextList;
}

// 当前测试状态
let currentTest = {
    type: null,
    theme: null,
    questions: [],
    currentIndex: 0,
    answers: [],
    startTime: null,
    showingFeedback: false
};

// 学习卡片状态管理
let cardStates = {
    // infinitive: { weight: number, hidden: boolean }
};

// DOM元素缓存
const domCache = {
    setupModal: null,
    fixedTopBar: null,
    unlockModal: null,
    retryModal: null,
    cardsContainer: null,
    headerDescription: null,
    totalCountElement: null,
    currentThemeName: null,
    testProgress: null,
    testInstruction: null,
    progressCompleted: null,
    progressLearning: null,
    progressLocked: null,
    get: function(id) {
        const cacheKey = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (!this[cacheKey]) {
            const element = document.getElementById(id);
            if (element) {
                this[cacheKey] = element;
            }
        }
        return this[cacheKey] || null;
    },
    init: function() {
        this.setupModal = document.getElementById('setup-modal');
        this.fixedTopBar = document.getElementById('fixed-top-bar');
        this.unlockModal = document.getElementById('unlock-modal');
        this.retryModal = document.getElementById('retry-modal');
        this.cardsContainer = document.getElementById('cards-container');
        this.headerDescription = document.getElementById('header-description');
        this.totalCountElement = document.getElementById('total-count');
        this.currentThemeName = document.getElementById('current-theme-name');
        this.testProgress = document.getElementById('test-progress');
        this.testInstruction = document.getElementById('test-instruction');
        this.progressCompleted = document.getElementById('progress-completed');
        this.progressLearning = document.getElementById('progress-learning');
        this.progressLocked = document.getElementById('progress-locked');
    },
    clear: function() {
        this.totalCountElement = null;
        this.currentThemeName = null;
    }
};

// ==================== 工具函数 ====================

// 音效函数
function playSound(frequency, duration, type = 'sine') {
    if (!window.AudioContext && !window.webkitAudioContext) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContext();

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    oscillator.type = type;

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
}

function playCorrectSound() {
    playSound(800, 0.2, 'sine');
    setTimeout(() => playSound(1000, 0.2, 'sine'), 100);
}

function playIncorrectSound() {
    // 没电的减弱音效：从较高音调逐渐降低并减弱
    playSound(180, 0.6, 'sawtooth');
    setTimeout(() => playSound(140, 0.4, 'sawtooth'), 300);
    setTimeout(() => playSound(100, 0.3, 'sawtooth'), 600);
}

function showModal(modalId) {
    let modal = domCache[modalId.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
    if (!modal) {
        modal = domCache.get(modalId);
    }
    if (modal) {
        modal.classList.add('show');
        modal.style.display = '';
    }
}

function hideModal(modalId) {
    let modal = domCache[modalId.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())];
    if (!modal) {
        modal = domCache.get(modalId);
    }
    if (modal) {
        modal.classList.remove('show');
        modal.style.display = 'none';
    }
}

function lockCardInteraction(card, duration = 700) {
    if (!card) return;
    card.dataset.interactionLocked = 'true';
    if (card._interactionLockTimer) {
        clearTimeout(card._interactionLockTimer);
    }
    card._interactionLockTimer = setTimeout(() => {
        delete card.dataset.interactionLocked;
        card._interactionLockTimer = null;
    }, duration);
}

// ==================== 配置管理函数 ====================

function saveUserConfig() {
    const userType = document.querySelector('input[name="userType"]:checked').value;
    const ability = document.querySelector('input[name="ability"]:checked').value;
    
    userConfig.userType = userType;
    userConfig.ability = ability;
    userConfig.setupCompleted = true;
    
    setTimeout(() => {
        try {
            localStorage.setItem('userConfig', JSON.stringify(userConfig));
        } catch (e) {
            error('保存用户配置失败:', e);
        }
    }, 0);
    
    initializeLearningProgress();
    hideModal('setup-modal');
    
    if (domCache.fixedTopBar) {
        domCache.fixedTopBar.style.display = 'flex';
    }
    
    updateHeaderDescription();
    updateTopBarProgress();
    updateCurrentThemeDisplay();
    loadCurrentTheme();
}

function loadUserConfig() {
    try {
        const saved = localStorage.getItem('userConfig');
        if (saved) {
            try {
                userConfig = JSON.parse(saved);
                if (!userConfig.userType || !userConfig.ability) {
                    warn('用户配置不完整，重置配置');
                    userConfig = {
                        userType: null,
                        ability: null,
                        setupCompleted: false
                    };
                    setTimeout(() => {
                        try {
                            localStorage.removeItem('userConfig');
                        } catch (e) {
                            error('删除用户配置失败:', e);
                        }
                    }, 0);
                }
            } catch (parseError) {
                error('解析用户配置失败:', parseError);
                userConfig = {
                    userType: null,
                    ability: null,
                    setupCompleted: false
                };
            }
        }
    } catch (e) {
        error('加载用户配置失败:', e);
        userConfig = {
            userType: null,
            ability: null,
            setupCompleted: false
        };
    }
}

function initializeLearningProgress() {
    const themes = themeOrder[userConfig.userType];
    const progress = {
        currentThemeIndex: 0,
        currentMode: 'learning',
        currentTestType: null,
        currentTheme: themes[0] || null,
        themes: {},
        carryOverMistakes: []
    };

    themes.forEach((theme, index) => {
        progress.themes[theme] = {
            status: index === 0 ? 'learning' : 'locked',
            test1: {
                status: index === 0 ? 'available' : 'locked',
                passRate: null,
                attempts: 0,
                firstAttemptPassRate: null,
                lastAttempt: null
            },
            test2: {
                status: 'locked',
                passRate: null,
                attempts: 0,
                unlocked: false,
                unlockable: false,
                lastAttempt: null
            }
        };
    });

    learningProgress = progress;
    saveLearningProgress();
}

function loadLearningProgress() {
    try {
        const saved = localStorage.getItem('learningProgress');
        if (saved) {
            try {
                learningProgress = JSON.parse(saved);
                
                if (!learningProgress || typeof learningProgress !== 'object') {
                    warn('学习进度数据无效，将重新初始化');
                    learningProgress = null;
                    setTimeout(() => {
                        try {
                            localStorage.removeItem('learningProgress');
                        } catch (e) {
                            error('删除学习进度失败:', e);
                        }
                    }, 0);
                } else {
                    if (!learningProgress.currentMode) {
                        learningProgress.currentMode = 'learning';
                    }
        
                    if (learningProgress.themes && typeof learningProgress.themes === 'object') {
                        Object.keys(learningProgress.themes).forEach(theme => {
                            const themeData = learningProgress.themes[theme];
                            if (themeData && themeData.status === 'learning' && themeData.test1 && themeData.test1.status === 'locked') {
                                themeData.test1.status = 'available';
                            }
                        });
                    }
                    
                    if (!Array.isArray(learningProgress.carryOverMistakes)) {
                        learningProgress.carryOverMistakes = [];
                    }
                }
            } catch (parseError) {
                error('解析学习进度失败:', parseError);
                learningProgress = null;
            }
        }
    } catch (e) {
        error('加载学习进度失败:', e);
        learningProgress = null;
    }
}

function saveLearningProgress() {
    setTimeout(() => {
        try {
            localStorage.setItem('learningProgress', JSON.stringify(learningProgress));
        } catch (e) {
            error('保存学习进度失败:', e);
        }
    }, 0);
}

// ==================== 界面更新函数 ====================

function updateHeaderDescription() {
    if (!domCache.headerDescription) return;
    if (learningProgress.currentMode === 'learning') {
        domCache.headerDescription.textContent = '点击卡片正面查看动词信息，背面查看配价和中文翻译';
    } else {
        domCache.headerDescription.textContent = '测试模式：选择正确答案';
    }
}

function switchMode(mode) {
    learningProgress.currentMode = mode;
    saveLearningProgress();
    
    document.querySelectorAll('.top-bar-mode-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`.top-bar-mode-btn[data-mode="${mode}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    updateHeaderDescription();
    
    if (domCache.fixedTopBar) {
        domCache.fixedTopBar.style.display = 'flex';
    }
    
    const testProgress = domCache.testProgress || domCache.get('test-progress');
    const testInstruction = domCache.testInstruction || domCache.get('test-instruction');
    
    if (mode === 'learning') {
        if (testProgress) {
            testProgress.style.display = 'none';
        }
        if (testInstruction) {
            testInstruction.style.display = 'none';
        }
        document.body.classList.remove('test-mode');
        loadCurrentTheme();
    } else {
        if (testProgress) {
            testProgress.style.display = 'flex';
        }
        document.body.classList.add('test-mode');
        const nextTestType = learningProgress.currentTestType || 'test1';
        startTest(nextTestType);
    }
}

function updateTopBarProgress() {
    if (!userConfig.setupCompleted) return;
    
    const themes = themeOrder[userConfig.userType] || [];
    let completed = 0;
    let learning = 0;
    let locked = 0;
    
    themes.forEach(theme => {
        const themeData = learningProgress.themes[theme] || {};
        if (themeData.status === 'completed') {
            completed++;
        } else if (themeData.status === 'learning') {
            learning++;
        } else if (themeData.status === 'locked') {
            locked++;
        }
    });
    
    const progressCompleted = domCache.progressCompleted || domCache.get('progress-completed');
    const progressLearning = domCache.progressLearning || domCache.get('progress-learning');
    const progressLocked = domCache.progressLocked || domCache.get('progress-locked');
    
    if (progressCompleted) progressCompleted.textContent = completed;
    if (progressLearning) progressLearning.textContent = learning;
    if (progressLocked) progressLocked.textContent = locked;
    
    updateCurrentThemeDisplay();
}

function updateCurrentThemeDisplay() {
    const currentTheme = learningProgress.currentTheme;
    const themeNameElement = domCache.currentThemeName || domCache.get('current-theme-name');
    
    if (currentTheme && themeNameElement) {
        themeNameElement.textContent = currentTheme;
    } else if (themeNameElement) {
        themeNameElement.textContent = '-';
    }
}

// ==================== 动词数据组织 ====================

// 格式化可分动词
function formatSeparableVerb(infinitive) {
    const specialExceptions = ['antworten'];
    const inseparablePrefixes = ['über', 'unter', 'durch', 'wieder', 'be', 'ge', 'er', 'ver', 'zer', 'ent', 'emp', 'miss'];
    const separablePrefixes = ['wieder', 'zurück', 'zusammen', 'fort', 'weg', 'hin', 'her', 'fern', 'teil', 'ab', 'an', 'auf', 'aus', 'ein', 'mit', 'um', 'zu', 'nach', 'vor'];
    
    if (infinitive.startsWith('sich ')) {
        const verbPart = infinitive.substring(5);
        for (const prefix of separablePrefixes) {
            if (verbPart.startsWith(prefix) && verbPart.length > prefix.length) {
                const rest = verbPart.substring(prefix.length);
                if (rest.length > 0) {
                    return `sich ${prefix} | ${rest}`;
                }
            }
        }
        return infinitive;
    }
    
    if (specialExceptions.includes(infinitive)) {
        return infinitive;
    }
    
    if (infinitive.includes(' ')) {
        return infinitive;
    }
    
    for (const prefix of inseparablePrefixes) {
        if (infinitive.startsWith(prefix) && infinitive.length > prefix.length) {
            return infinitive;
        }
    }
    
    for (const prefix of separablePrefixes) {
        if (infinitive.startsWith(prefix) && infinitive.length > prefix.length) {
            const rest = infinitive.substring(prefix.length);
            if (rest.length > 0 && !separablePrefixes.some(p => rest.startsWith(p)) && !inseparablePrefixes.some(p => rest.startsWith(p))) {
                return `${prefix} | ${rest}`;
            }
        }
    }
    
    return infinitive;
}

// 翻译映射函数
function generateTranslation(example, meaning, infinitive) {
    const cleanExample = example.replace(/<[^>]*>/g, '');
    
    const translations = {
        "Ich arbeite.": "我工作。",
        "Sie tanzt gut.": "她跳得很好。",
        "Wir frühstücken um 7 Uhr.": "我们7点吃早餐。",
        "Er raucht nicht.": "他不吸烟。",
        "Die Kinder lachen.": "孩子们笑。",
        "Er lebt in Köln.": "他住在科隆。",
        "Wir reisen nach Spanien.": "我们旅行去西班牙。",
        "Sie wandern gern.": "他们喜欢徒步。",
        "Der Film dauert zwei Stunden.": "这部电影持续两小时。",
        "Die Party endet um Mitternacht.": "聚会午夜结束。",
        "Es regnet.": "下雨了。",
        "Was ist passiert?": "发生了什么？",
        "Schwimmen Sie gern?": "您喜欢游泳吗？",
        "Wann kommen Sie?": "您什么时候来？",
        "Wohin gehen Sie?": "您去哪里？",
        "Fliegen Sie nach Berlin?": "您飞往柏林吗？",
        "Bleiben Sie hier!": "您留在这里！",
        "Wann kommen Sie an?": "您什么时候到达？",
        "Kommen Sie mit!": "您一起来！",
        "Er ist auf den Berg gestiegen.": "他登上了山。",
        "Steigen Sie bitte ein!": "请您上车！",
        "Steigen Sie an der nächsten Station aus!": "请您在下一站下车！",
        "Stehen Sie um 7 Uhr auf!": "请您7点起床！",
        "Ziehen Sie nächsten Monat um!": "请您下个月搬家！",
        "Wann fliegt das Flugzeug ab?": "飞机什么时候起飞？",
        "Fährt der Zug pünktlich ab?": "火车准时出发吗？",
        "Laufen Sie schnell?": "您跑得快吗？",
        "Fahren Sie nach Berlin?": "您去柏林吗？",
        "Sitzen Sie am Tisch?": "您坐在桌边吗？",
        "Gewinnen Sie das Spiel?": "您赢得比赛吗？",
        "Liegt das Buch auf dem Tisch?": "书平放在桌子上吗？",
        "Riecht das gut?": "这闻起来好吗？",
        "Steht das Haus am Fluss?": "房子位于河边吗？",
        "Scheint die Sonne?": "太阳照耀吗？",
        "Wie heißen Sie?": "您叫什么名字？",
        "Sie sehen müde aus.": "您看起来累。",
        "Sehen Sie oft fern?": "您经常看电视吗？",
        "Schlafen Sie gut?": "您睡得好吗？",
        "Sprechen Sie Deutsch?": "您说德语吗？",
        "Ich telefoniere mit meiner Mutter.": "我和我母亲打电话。",
        "Hören Sie mit dem Rauchen auf!": "请您停止吸烟！",
        "Ich warte auf den Bus.": "我等待公共汽车。",
        "Er ist hier bekannt.": "他在这里是熟悉的。",
        "Der Platz ist besetzt.": "这个位置被占用了。",
        "Das ist hier verboten.": "这在这里是被禁止的。",
        "Das Geschäft ist geöffnet.": "商店是打开着的。",
        "Die Bank ist geschlossen.": "银行是关闭的。",
        "Ich bin in Berlin geboren.": "我在柏林出生。",
        "Sie ist verheiratet.": "她是结婚的。",
        "Sein Großvater ist gestorben.": "他的祖父去世了。",
        "Mein Schlüssel ist weg.": "我的钥匙不见了。",
        "Das Licht ist an.": "灯是开着的（电器）。",
        "Der Computer ist aus.": "电脑是关闭的（电器）。",
        "Das Fenster ist auf.": "窗户是向上开着的。",
        "Die Tür ist zu.": "门是闭合的。",
        "Er ist Lehrer.": "他是老师。",
        "Er wird Arzt.": "他成为医生。",
        "Sie tanzt Tango.": "她跳探戈。",
        "Ich frühstücke Brot.": "我吃面包（早餐食物）。",
        "Er raucht Zigaretten.": "他抽香烟。",
        "Das kostet viel Geld.": "这花费很多钱。",
        "Er repariert das Auto.": "他修理汽车。",
        "Buchstabieren Sie Ihren Namen!": "请您拼写您的名字！",
        "Sie studiert Musik.": "她学音乐（大学专业）。",
        "Ich brauche Hilfe.": "我需要帮助。",
        "Er druckt ein Dokument.": "他打印一份文件。",
        "Sie drückt den Knopf.": "她按按钮。",
        "Wir grillen Fleisch.": "我们烧烤肉。",
        "Ich frage dich.": "我问你。",
        "Sie heiratet ihn.": "她和他结婚。",
        "Ich hole die Post.": "我取邮件。",
        "Wir hören Musik.": "我们听音乐。",
        "Sie kauft Brot.": "她买面包。",
        "Er kocht Nudeln.": "他煮面条。",
        "Legen Sie das Buch auf den Tisch!": "请您把书平放在桌子上！",
        "Ich liebe dich.": "我爱你。",
        "Was machen Sie?": "您做什么？",
        "Wir mieten eine Wohnung.": "我们租一套公寓。",
        "Öffnen Sie das Fenster!": "请您打开窗户！",
        "Sagen Sie etwas!": "请您说点什么！",
        "Die Kinder spielen Fußball.": "孩子们玩足球。",
        "Wir feiern Geburtstag.": "我们庆祝生日。",
        "Ich glaube das nicht.": "我不相信这个。",
        "Wir zahlen die Rechnung.": "我们支付账单。",
        "Bezahlen Sie die Rechnung!": "请您支付账单！",
        "Stellen Sie den Computer auf den Tisch!": "请您把电脑竖放在桌子上！",
        "Ich bestelle Pizza.": "我订购披萨。",
        "Ich suche meinen Schlüssel.": "我寻找我的钥匙。",
        "Wir besuchen unsere Freunde.": "我们拜访我们的朋友。",
        "Wir besichtigen das Museum.": "我们参观博物馆。",
        "Was bedeutet das Wort?": "这个词是什么意思？",
        "Ich benutze den Computer.": "我使用电脑。",
        "Wir verkaufen unser Auto.": "我们卖出我们的汽车。",
        "Er vermietet seine Wohnung.": "他出租他的公寓。",
        "Sie verdient viel Geld.": "她赚很多钱。",
        "Klicken Sie den Button an!": "请您点击按钮！",
        "Kreuzen Sie die Antwort an!": "请您在答案上打勾！",
        "Ich kaufe Lebensmittel ein.": "我采购食品。",
        "Holen Sie mich ab!": "请您接我！",
        "Füllen Sie das Formular aus!": "请您填写表格！",
        "Machen Sie das Licht aus!": "请您关闭灯（电器）！",
        "Machen Sie das Licht an!": "请您打开灯（电器）！",
        "Machen Sie das Fenster auf!": "请您打开窗户（物理）！",
        "Machen Sie die Tür zu!": "请您关闭门（物理）！",
        "Machen Sie das Spiel mit?": "您参加游戏吗？",
        "Räumen Sie Ihr Zimmer auf!": "请您整理您的房间！",
        "Ich lerne Deutsch.": "我学德语。",
        "Ich lerne dich kennen.": "我结识你。",
        "Kennst du den Film?": "你认识这部电影吗？",
        "Ich weiß die Antwort.": "我知道答案。",
        "Ich mag Kaffee.": "我喜欢咖啡。",
        "Ich finde das gut.": "我认为这个好。",
        "Ich bitte dich um Hilfe.": "我请求你帮助。",
        "Bringen Sie mir das Buch!": "请您给我带来书！",
        "Ich trinke Wasser.": "我喝水。",
        "Er schreibt einen Brief.": "他写一封信。",
        "Unterschreiben Sie das Dokument!": "请您在文件上签名！",
        "Wir beginnen den Unterricht.": "我们开始课程。",
        "Ich bekomme einen Brief.": "我收到一封信。",
        "Verstehen Sie die Frage?": "您理解这个问题吗？",
        "Schließen Sie die Tür!": "请您关闭门！",
        "Ich überweise Geld.": "我汇款。",
        "Was tun Sie?": "您做什么？",
        "Rufen Sie mich an!": "请您给我打电话！",
        "Ich biete Hilfe an.": "我提供帮助。",
        "Bringen Sie etwas mit!": "请您携带一些东西！",
        "Wir gewinnen das Spiel.": "我们赢得比赛。",
        "Ich backe einen Kuchen.": "我烘焙一个蛋糕。",
        "Ich vergesse immer die Hausaufgaben.": "我总是忘记作业。",
        "Er fährt ein Auto.": "他驾驶一辆汽车。",
        "Wir sprechen Deutsch.": "我们说德语。",
        "Ich fahre Fahrrad.": "我骑自行车。",
        "Halten Sie meine Hand?": "您握住我的手吗？",
        "Ich wasche das Auto.": "我洗汽车。",
        "Ich lese ein Buch.": "我读一本书。",
        "Sehen Sie den Film?": "您看这部电影吗？",
        "Nehmen Sie ein Taxi!": "请您乘坐出租车！",
        "Ich esse einen Apfel.": "我吃一个苹果。",
        "Wir treffen unsere Freunde.": "我们遇见我们的朋友。",
        "Hier gibt es viele Restaurants.": "这里有很多餐厅。",
        "Ich habe ein Auto.": "我有一辆汽车。",
        "Fangen Sie die Arbeit an?": "您开始工作吗？",
        "Geben Sie die Hausaufgaben ab!": "请您递交作业！",
        "Ich lade dich ein.": "我邀请你。",
        "Nehmen Sie den Regenschirm mit!": "请您带走雨伞！",
        "Ich antworte dir.": "我回答你。",
        "Ich danke Ihnen.": "我感谢您。",
        "Das schmeckt mir.": "这尝起来对我（好）。",
        "Ich glaube dir.": "我相信你。",
        "Ich gratuliere dir.": "我祝贺你。",
        "Du fehlst mir.": "你缺少/想念对我。",
        "Das gehört mir.": "这属于我。",
        "Ich helfe dir.": "我帮助你。",
        "Das gefällt mir.": "这使我喜欢。",
        "Ich erkläre dir die Regel.": "我向你解释规则。",
        "Er erlaubt mir das.": "他允许我这个。",
        "Erzählen Sie mir eine Geschichte!": "请您给我讲述一个故事！",
        "Ich schenke dir ein Buch.": "我赠送你一本书。",
        "Ich schicke dir eine E-Mail.": "我发送给你一封电子邮件。",
        "Ich gebe dir das Buch.": "我给你书。",
        "Ich empfehle dir das Restaurant.": "我推荐你这家餐厅。",
        "Ich kann gut schwimmen.": "我能够很好地游泳。",
        "Ich muss lernen.": "我必须学习。",
        "Ich möchte essen.": "我想要吃。",
        "Ich will kommen.": "我想要来。",
        "Ich soll arbeiten.": "我应该工作。",
        "Du darfst jetzt gehen.": "允许你现在走。",
        "Ich dusche mich.": "我淋浴。",
        "Ich bade mich.": "我泡澡。",
        "Ich entschuldige mich.": "我道歉。",
        "Ich melde mich an.": "我报名。",
        "Ich kümmere mich um das Kind.": "我照顾孩子。",
        "Du musst dich warm anziehen.": "你必须穿暖和。",
        "Ich ziehe mich aus.": "我脱衣服。",
        "Ich freue mich auf Ihre Antwort.": "我期待您的回答。"
    };
    
    return translations[cleanExample] || cleanExample;
}

// A1动词数据（完整版 - 175个动词）
// 注意：这里先定义原始数据，然后根据主题分类重新组织
const allVerbs = [
    // 类别1: 主语 + 动作 (45个)
    {infinitive: "arbeiten", pres3: "", pii: "", example: "Ich arbeite.", meaning: "工作", valence: "jd. arbeitet", category: "category1"},
    {infinitive: "tanzen", pres3: "", pii: "", example: "Sie tanzt gut.", meaning: "跳舞", valence: "jd. tanzt", category: "category1"},
    {infinitive: "frühstücken", pres3: "", pii: "", example: "Wir frühstücken um 7 Uhr.", meaning: "吃早餐", valence: "jd. frühstückt", category: "category1"},
    {infinitive: "rauchen", pres3: "", pii: "", example: "Er raucht nicht.", meaning: "吸烟", valence: "jd. raucht", category: "category1"},
    {infinitive: "lachen", pres3: "", pii: "", example: "Die Kinder lachen.", meaning: "笑", valence: "jd. lacht", category: "category1"},
    {infinitive: "leben", pres3: "", pii: "", example: "Er lebt in Köln.", meaning: "生活", valence: "jd. lebt", category: "category1"},
    {infinitive: "reisen", pres3: "", pii: "gereist*", example: "Wir reisen nach Spanien.", meaning: "旅行", valence: "jd. reist", category: "category1"},
    {infinitive: "wandern", pres3: "", pii: "", example: "Sie wandern gern.", meaning: "徒步", valence: "jd. wandert", category: "category1"},
    {infinitive: "dauern", pres3: "", pii: "", example: "Der Film dauert zwei Stunden.", meaning: "持续", valence: "etw. dauert", category: "category1"},
    {infinitive: "enden", pres3: "", pii: "", example: "Die Party endet um Mitternacht.", meaning: "结束", valence: "etw. endet", category: "category1"},
    {infinitive: "regnen", pres3: "", pii: "", example: "Es regnet.", meaning: "下雨", valence: "es regnet", category: "category1"},
    {infinitive: "passieren", pres3: "", pii: "passiert*", example: "Was ist passiert?", meaning: "发生", valence: "etw. passiert", category: "category1"},
    {infinitive: "schwimmen", pres3: "", pii: "geschwommen*", example: "Schwimmen Sie gern?", meaning: "游泳", valence: "jd. schwimmt", category: "category1"},
    {infinitive: "kommen", pres3: "", pii: "gekommen*", example: "Wann kommen Sie?", meaning: "来", valence: "jd. kommt", category: "category1"},
    {infinitive: "gehen", pres3: "", pii: "gegangen*", example: "Wohin gehen Sie?", meaning: "走", valence: "jd. geht", category: "category1"},
    {infinitive: "fliegen", pres3: "", pii: "geflogen*", example: "Fliegen Sie nach Berlin?", meaning: "飞", valence: "jd./etw. fliegt", category: "category1"},
    {infinitive: "bleiben", pres3: "", pii: "geblieben*", example: "Bleiben Sie hier!", meaning: "停留", valence: "jd. bleibt", category: "category1"},
    {infinitive: "ankommen", pres3: "", pii: "angekommen*", example: "Wann kommen Sie an?", meaning: "抵达", valence: "jd. kommt an", category: "category1"},
    {infinitive: "mitkommen", pres3: "", pii: "mitgekommen*", example: "Kommen Sie mit!", meaning: "一起来", valence: "jd. kommt mit", category: "category1"},
    {infinitive: "steigen", pres3: "", pii: "gestiegen*", example: "Er ist auf den Berg gestiegen.", meaning: "攀登", valence: "jd. steigt", category: "category1"},
    {infinitive: "einsteigen", pres3: "", pii: "eingestiegen*", example: "Steigen Sie bitte ein!", meaning: "上车/进入", valence: "jd. steigt ein", category: "category1"},
    {infinitive: "aussteigen", pres3: "", pii: "ausgestiegen*", example: "Steigen Sie an der nächsten Station aus!", meaning: "下车/出来", valence: "jd. steigt aus", category: "category1"},
    {infinitive: "aufstehen", pres3: "", pii: "aufgestanden*", example: "Stehen Sie um 7 Uhr auf!", meaning: "起床/站起来", valence: "jd. steht auf", category: "category1"},
    {infinitive: "umziehen", pres3: "", pii: "umgezogen*", example: "Ziehen Sie nächsten Monat um!", meaning: "搬家", valence: "jd. zieht um", category: "category1"},
    {infinitive: "abfliegen", pres3: "", pii: "abgeflogen*", example: "Wann fliegt das Flugzeug ab?", meaning: "起飞", valence: "etw. fliegt ab", category: "category1"},
    {infinitive: "abfahren", pres3: "fährt ab", pii: "abgefahren*", example: "Fährt der Zug pünktlich ab?", meaning: "出发", valence: "jd./etw. fährt ab", category: "category1"},
    {infinitive: "laufen", pres3: "läuft", pii: "gelaufen*", example: "Laufen Sie schnell?", meaning: "跑/运行", valence: "jd. läuft", category: "category1"},
    {infinitive: "fahren", pres3: "fährt", pii: "gefahren*", example: "Fahren Sie nach Berlin?", meaning: "去/乘坐", valence: "jd. fährt", category: "category1"},
    {infinitive: "sitzen", pres3: "", pii: "gesessen", example: "Sitzen Sie am Tisch?", meaning: "坐", valence: "jd. sitzt", category: "category1"},
    {infinitive: "gewinnen", pres3: "", pii: "gewonnen", example: "Gewinnen Sie das Spiel?", meaning: "赢", valence: "jd. gewinnt", category: "category1"},
    {infinitive: "liegen", pres3: "", pii: "gelegen", example: "Liegt das Buch auf dem Tisch?", meaning: "平放/位于", valence: "etw. liegt", category: "category1"},
    {infinitive: "riechen", pres3: "", pii: "gerochen", example: "Riecht das gut?", meaning: "闻", valence: "jd./etw. riecht", category: "category1"},
    {infinitive: "stehen", pres3: "", pii: "gestanden", example: "Steht das Haus am Fluss?", meaning: "站立/位于", valence: "jd./etw. steht", category: "category1"},
    {infinitive: "scheinen", pres3: "", pii: "geschienen", example: "Scheint die Sonne?", meaning: "照耀", valence: "etw. scheint", category: "category1"},
    {infinitive: "heißen", pres3: "", pii: "geheißen", example: "Wie heißen Sie?", meaning: "叫/名为", valence: "jd. heißt", category: "category1"},
    {infinitive: "aussehen", pres3: "sieht aus", pii: "ausgesehen", example: "Sie sehen müde aus.", meaning: "看起来", valence: "jd. sieht aus", category: "category1"},
    {infinitive: "fernsehen", pres3: "sieht fern", pii: "ferngesehen", example: "Sehen Sie oft fern?", meaning: "看电视", valence: "jd. sieht fern", category: "category1"},
    {infinitive: "schlafen", pres3: "schläft", pii: "geschlafen", example: "Schlafen Sie gut?", meaning: "睡觉", valence: "jd. schläft", category: "category1"},
    {infinitive: "sprechen", pres3: "spricht", pii: "gesprochen", example: "Sprechen Sie Deutsch?", meaning: "说话", valence: "jd. spricht", category: "category1"},
    {infinitive: "telefonieren", pres3: "", pii: "", example: "Ich telefoniere <span class=\"dat-bg-opacity\">mit meiner Mutter</span>.", meaning: "打电话", valence: "jd. telefoniert [<span class=\"dat-bg-opacity\">mit Dat</span>]", category: "category1"},
    {infinitive: "aufhören", pres3: "", pii: "", example: "Hören Sie <span class=\"dat-bg-opacity\">mit dem Rauchen</span> auf!", meaning: "停止", valence: "jd. hört [<span class=\"dat-bg-opacity\">mit Dat</span>] auf", category: "category1"},
    {infinitive: "warten", pres3: "", pii: "", example: "Ich warte <span class=\"akk-bg-opacity\">auf den Bus</span>.", meaning: "等待", valence: "jd. wartet [<span class=\"akk-bg-opacity\">auf Akk</span>]", category: "category1"},
    
    // 类别2: 主语 + 系动词 + 表语 (15个)
    {infinitive: "bekannt sein", pres3: "", pii: "", example: "Er ist hier bekannt.", meaning: "熟悉的", valence: "jd. ist bekannt", category: "category2"},
    {infinitive: "besetzt sein", pres3: "", pii: "", example: "Der Platz ist besetzt.", meaning: "被占用的", valence: "etw. ist besetzt", category: "category2"},
    {infinitive: "verboten sein", pres3: "", pii: "", example: "Das ist hier verboten.", meaning: "被禁止的", valence: "etw. ist verboten", category: "category2"},
    {infinitive: "geöffnet sein", pres3: "", pii: "", example: "Das Geschäft ist geöffnet.", meaning: "打开着的", valence: "etw. ist geöffnet", category: "category2"},
    {infinitive: "geschlossen sein", pres3: "", pii: "", example: "Die Bank ist geschlossen.", meaning: "关闭的", valence: "etw. ist geschlossen", category: "category2"},
    {infinitive: "geboren sein", pres3: "", pii: "", example: "Ich bin in Berlin geboren.", meaning: "出生的", valence: "jd. ist geboren", category: "category2"},
    {infinitive: "verheiratet sein", pres3: "", pii: "", example: "Sie ist verheiratet.", meaning: "结婚的", valence: "jd. ist verheiratet", category: "category2"},
    {infinitive: "gestorben sein", pres3: "", pii: "", example: "Sein Großvater ist gestorben.", meaning: "去世的", valence: "jd. ist gestorben", category: "category2"},
    {infinitive: "weg sein", pres3: "", pii: "", example: "Mein Schlüssel ist weg.", meaning: "离开/不见了", valence: "jd./etw. ist weg", category: "category2"},
    {infinitive: "an sein", pres3: "", pii: "", example: "Das Licht ist an.", meaning: "开着(电器)", valence: "etw. ist an", category: "category2"},
    {infinitive: "aus sein", pres3: "", pii: "", example: "Der Computer ist aus.", meaning: "关闭(电器)", valence: "etw. ist aus", category: "category2"},
    {infinitive: "auf sein", pres3: "", pii: "", example: "Das Fenster ist auf.", meaning: "向上开着", valence: "etw. ist auf", category: "category2"},
    {infinitive: "zu sein", pres3: "", pii: "", example: "Die Tür ist zu.", meaning: "闭合的", valence: "etw. ist zu", category: "category2"},
    {infinitive: "sein", pres3: "ist", pii: "gewesen*", example: "Er ist Lehrer.", meaning: "是", valence: "jd./etw. ist", category: "category2"},
    {infinitive: "werden", pres3: "wird", pii: "geworden*", example: "Er wird Arzt.", meaning: "成为", valence: "jd. wird", category: "category2"},
    
    // 类别3: 主语 + 动作 + [Akk]直接宾语 (88个)
    {infinitive: "tanzen", pres3: "", pii: "", example: "Sie tanzt <span class=\"akk-bg\">Tango</span>.", meaning: "跳(某种舞)", valence: "jd. tanzt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "frühstücken", pres3: "", pii: "", example: "Ich frühstücke <span class=\"akk-bg\">Brot</span>.", meaning: "吃(早餐食物)", valence: "jd. frühstückt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "rauchen", pres3: "", pii: "", example: "Er raucht <span class=\"akk-bg\">Zigaretten</span>.", meaning: "抽(烟)", valence: "jd. raucht <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "kosten", pres3: "", pii: "", example: "Das kostet <span class=\"akk-bg\">viel Geld</span>.", meaning: "花费", valence: "etw. kostet <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "reparieren", pres3: "", pii: "", example: "Er repariert <span class=\"akk-bg\">das Auto</span>.", meaning: "修理", valence: "jd. repariert <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "buchstabieren", pres3: "", pii: "", example: "Buchstabieren Sie <span class=\"akk-bg\">Ihren Namen</span>!", meaning: "拼写", valence: "jd. buchstabiert <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "studieren", pres3: "", pii: "", example: "Sie studiert <span class=\"akk-bg\">Musik</span>.", meaning: "学(大学专业)", valence: "jd. studiert <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "brauchen", pres3: "", pii: "", example: "Ich brauche <span class=\"akk-bg\">Hilfe</span>.", meaning: "需要", valence: "jd. braucht <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "drucken", pres3: "", pii: "", example: "Er druckt <span class=\"akk-bg\">ein Dokument</span>.", meaning: "打印", valence: "jd. druckt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "drücken", pres3: "", pii: "", example: "Sie drückt <span class=\"akk-bg\">den Knopf</span>.", meaning: "按", valence: "jd. drückt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "grillen", pres3: "", pii: "", example: "Wir grillen <span class=\"akk-bg\">Fleisch</span>.", meaning: "烧烤", valence: "jd. grillt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "fragen", pres3: "", pii: "", example: "Ich frage <span class=\"akk-bg\">dich</span>.", meaning: "问(某人)", valence: "jd. fragt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "heiraten", pres3: "", pii: "", example: "Sie heiratet <span class=\"akk-bg\">ihn</span>.", meaning: "结婚", valence: "jd. heiratet <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "holen", pres3: "", pii: "", example: "Ich hole <span class=\"akk-bg\">die Post</span>.", meaning: "取", valence: "jd. holt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "hören", pres3: "", pii: "", example: "Wir hören <span class=\"akk-bg\">Musik</span>.", meaning: "听", valence: "jd. hört <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "kaufen", pres3: "", pii: "", example: "Sie kauft <span class=\"akk-bg\">Brot</span>.", meaning: "买", valence: "jd. kauft <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "kochen", pres3: "", pii: "", example: "Er kocht <span class=\"akk-bg\">Nudeln</span>.", meaning: "煮", valence: "jd. kocht <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "legen", pres3: "", pii: "", example: "Legen Sie <span class=\"akk-bg\">das Buch</span> auf den Tisch!", meaning: "平放", valence: "jd. legt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "lieben", pres3: "", pii: "", example: "Ich liebe <span class=\"akk-bg\">dich</span>.", meaning: "爱", valence: "jd. liebt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "machen", pres3: "", pii: "", example: "<span class=\"akk-bg\">Was</span> machen Sie?", meaning: "做", valence: "jd. macht <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "machen", pres3: "", pii: "", example: "<span class=\"akk-bg\">Was</span> machen Sie?", meaning: "做", valence: "jd. macht <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "mieten", pres3: "", pii: "", example: "Wir mieten <span class=\"akk-bg\">eine Wohnung</span>.", meaning: "租", valence: "jd. mietet <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "öffnen", pres3: "", pii: "", example: "Öffnen Sie <span class=\"akk-bg\">das Fenster</span>!", meaning: "打开", valence: "jd. öffnet <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "sagen", pres3: "", pii: "", example: "Sagen Sie <span class=\"akk-bg\">etwas</span>!", meaning: "说", valence: "jd. sagt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "spielen", pres3: "", pii: "", example: "Die Kinder spielen <span class=\"akk-bg\">Fußball</span>.", meaning: "玩", valence: "jd. spielt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "feiern", pres3: "", pii: "", example: "Wir feiern <span class=\"akk-bg\">Geburtstag</span>.", meaning: "庆祝", valence: "jd. feiert <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "glauben", pres3: "", pii: "", example: "Ich glaube <span class=\"akk-bg\">das nicht</span>.", meaning: "相信(某事)", valence: "jd. glaubt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "zahlen", pres3: "", pii: "", example: "Wir zahlen <span class=\"akk-bg\">die Rechnung</span>.", meaning: "支付", valence: "jd. zahlt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "bezahlen", pres3: "", pii: "", example: "Bezahlen Sie <span class=\"akk-bg\">die Rechnung</span>!", meaning: "支付", valence: "jd. bezahlt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "stellen", pres3: "", pii: "", example: "Stellen Sie <span class=\"akk-bg\">den Computer</span> auf den Tisch!", meaning: "竖放", valence: "jd. stellt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "bestellen", pres3: "", pii: "", example: "Ich bestelle <span class=\"akk-bg\">Pizza</span>.", meaning: "订购", valence: "jd. bestellt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "suchen", pres3: "", pii: "", example: "Ich suche <span class=\"akk-bg\">meinen Schlüssel</span>.", meaning: "寻找", valence: "jd. sucht <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "besuchen", pres3: "", pii: "", example: "Wir besuchen <span class=\"akk-bg\">unsere Freunde</span>.", meaning: "拜访", valence: "jd. besucht <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "besichtigen", pres3: "", pii: "", example: "Wir besichtigen <span class=\"akk-bg\">das Museum</span>.", meaning: "参观", valence: "jd. besichtigt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "bedeuten", pres3: "", pii: "", example: "Was bedeutet <span class=\"akk-bg\">das Wort</span>?", meaning: "意思是", valence: "etw. bedeutet <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "benutzen", pres3: "", pii: "", example: "Ich benutze <span class=\"akk-bg\">den Computer</span>.", meaning: "使用", valence: "jd. benutzt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "verkaufen", pres3: "", pii: "", example: "Wir verkaufen <span class=\"akk-bg\">unser Auto</span>.", meaning: "卖出", valence: "jd. verkauft <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "vermieten", pres3: "", pii: "", example: "Er vermietet <span class=\"akk-bg\">seine Wohnung</span>.", meaning: "出租", valence: "jd. vermietet <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "verdienen", pres3: "", pii: "", example: "Sie verdient <span class=\"akk-bg\">viel Geld</span>.", meaning: "赚得", valence: "jd. verdient <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "anklicken", pres3: "", pii: "", example: "Klicken Sie <span class=\"akk-bg\">den Button</span> an!", meaning: "点击", valence: "jd. klickt <span class=\"akk-bg\">Akk</span> an", category: "category3"},
    {infinitive: "ankreuzen", pres3: "", pii: "", example: "Kreuzen Sie <span class=\"akk-bg\">die Antwort</span> an!", meaning: "打勾", valence: "jd. kreuzt <span class=\"akk-bg\">Akk</span> an", category: "category3"},
    {infinitive: "einkaufen", pres3: "", pii: "", example: "Ich kaufe <span class=\"akk-bg\">Lebensmittel</span> ein.", meaning: "采购", valence: "jd. kauft <span class=\"akk-bg\">Akk</span> ein", category: "category3"},
    {infinitive: "abholen", pres3: "", pii: "", example: "Holen Sie <span class=\"akk-bg\">mich</span> ab!", meaning: "接", valence: "jd. holt <span class=\"akk-bg\">Akk</span> ab", category: "category3"},
    {infinitive: "ausfüllen", pres3: "", pii: "", example: "Füllen Sie <span class=\"akk-bg\">das Formular</span> aus!", meaning: "填写", valence: "jd. füllt <span class=\"akk-bg\">Akk</span> aus", category: "category3"},
    {infinitive: "ausmachen", pres3: "", pii: "", example: "Machen Sie <span class=\"akk-bg\">das Licht</span> aus!", meaning: "关闭(电器)", valence: "jd. macht <span class=\"akk-bg\">Akk</span> aus", category: "category3"},
    {infinitive: "anmachen", pres3: "", pii: "", example: "Machen Sie <span class=\"akk-bg\">das Licht</span> an!", meaning: "打开(电器)", valence: "jd. macht <span class=\"akk-bg\">Akk</span> an", category: "category3"},
    {infinitive: "aufmachen", pres3: "", pii: "", example: "Machen Sie <span class=\"akk-bg\">das Fenster</span> auf!", meaning: "(物理)打开", valence: "jd. macht <span class=\"akk-bg\">Akk</span> auf", category: "category3"},
    {infinitive: "zumachen", pres3: "", pii: "", example: "Machen Sie <span class=\"akk-bg\">die Tür</span> zu!", meaning: "(物理)关闭", valence: "jd. macht <span class=\"akk-bg\">Akk</span> zu", category: "category3"},
    {infinitive: "mitmachen", pres3: "", pii: "", example: "Machen Sie <span class=\"akk-bg\">das Spiel</span> mit?", meaning: "参加", valence: "jd. macht <span class=\"akk-bg\">Akk</span> mit", category: "category3"},
    {infinitive: "aufräumen", pres3: "", pii: "", example: "Räumen Sie <span class=\"akk-bg\">Ihr Zimmer</span> auf!", meaning: "整理", valence: "jd. räumt <span class=\"akk-bg\">Akk</span> auf", category: "category3"},
    {infinitive: "lernen", pres3: "", pii: "", example: "Ich lerne <span class=\"akk-bg\">Deutsch</span>.", meaning: "学习", valence: "jd. lernt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "kennen lernen", pres3: "", pii: "", example: "Ich lerne <span class=\"akk-bg\">dich</span> kennen.", meaning: "结识", valence: "jd. lernt <span class=\"akk-bg\">Akk</span> kennen", category: "category3"},
    {infinitive: "kennen", pres3: "", pii: "gekannt", example: "Kennst du <span class=\"akk-bg\">den Film</span>?", meaning: "认识", valence: "jd. kennt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "wissen", pres3: "weiß", pii: "gewusst", example: "Ich weiß <span class=\"akk-bg\">die Antwort</span>.", meaning: "知道", valence: "jd. weiß <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "mögen", pres3: "mag", pii: "gemocht", example: "Ich mag <span class=\"akk-bg\">Kaffee</span>.", meaning: "喜欢", valence: "jd. mag <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "finden", pres3: "", pii: "gefunden", example: "Ich finde <span class=\"akk-bg\">das gut</span>.", meaning: "找到/认为", valence: "jd. findet <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "bitten", pres3: "", pii: "gebeten", example: "Ich bitte <span class=\"akk-bg\">dich</span> <span class=\"akk-bg-opacity\">um Hilfe</span>.", meaning: "请求", valence: "jd. bittet <span class=\"akk-bg\">Akk</span> [<span class=\"akk-bg-opacity\">um Akk</span>]", category: "category3"},
    {infinitive: "trinken", pres3: "", pii: "getrunken", example: "Ich trinke <span class=\"akk-bg\">Wasser</span>.", meaning: "喝", valence: "jd. trinkt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "schreiben", pres3: "", pii: "geschrieben", example: "Er schreibt <span class=\"akk-bg\">einen Brief</span>.", meaning: "写", valence: "jd. schreibt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "unterschreiben", pres3: "", pii: "unterschrieben", example: "Unterschreiben Sie <span class=\"akk-bg\">das Dokument</span>!", meaning: "签名", valence: "jd. unterschreibt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "beginnen", pres3: "", pii: "begonnen", example: "Wir beginnen <span class=\"akk-bg\">den Unterricht</span>.", meaning: "开始", valence: "jd. beginnt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "bekommen", pres3: "", pii: "bekommen", example: "Ich bekomme <span class=\"akk-bg\">einen Brief</span>.", meaning: "收到", valence: "jd. bekommt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "verstehen", pres3: "", pii: "verstanden", example: "Verstehen Sie <span class=\"akk-bg\">die Frage</span>?", meaning: "理解", valence: "jd. versteht <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "schließen", pres3: "", pii: "geschlossen", example: "Schließen Sie <span class=\"akk-bg\">die Tür</span>!", meaning: "关闭", valence: "jd. schließt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "überweisen", pres3: "", pii: "überwiesen", example: "Ich überweise <span class=\"akk-bg\">Geld</span>.", meaning: "汇款", valence: "jd. überweist <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "tun", pres3: "", pii: "getan", example: "<span class=\"akk-bg\">Was</span> tun Sie?", meaning: "做", valence: "jd. tut <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "anrufen", pres3: "", pii: "angerufen", example: "Rufen Sie <span class=\"akk-bg\">mich</span> an!", meaning: "打电话", valence: "jd. ruft <span class=\"akk-bg\">Akk</span> an", category: "category3"},
    {infinitive: "anbieten", pres3: "", pii: "angeboten", example: "Ich biete <span class=\"akk-bg\">Hilfe</span> an.", meaning: "提供", valence: "jd. bietet <span class=\"akk-bg\">Akk</span> an", category: "category3"},
    {infinitive: "mitbringen", pres3: "", pii: "mitgebracht", example: "Bringen Sie <span class=\"akk-bg\">etwas</span> mit!", meaning: "携带", valence: "jd. bringt <span class=\"akk-bg\">Akk</span> mit", category: "category3"},
    {infinitive: "gewinnen", pres3: "", pii: "gewonnen", example: "Wir gewinnen <span class=\"akk-bg\">das Spiel</span>.", meaning: "赢得", valence: "jd. gewinnt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "backen", pres3: "bäckt", pii: "gebacken", example: "Ich backe <span class=\"akk-bg\">einen Kuchen</span>.", meaning: "烘焙", valence: "jd. bäckt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "vergessen", pres3: "vergisst", pii: "vergessen", example: "Ich vergesse immer <span class=\"akk-bg\">die Hausaufgaben</span>.", meaning: "忘记", valence: "jd. vergisst <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "fahren", pres3: "fährt", pii: "gefahren", example: "Er fährt <span class=\"akk-bg\">ein Auto</span>.", meaning: "驾驶", valence: "jd. fährt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "sprechen", pres3: "spricht", pii: "gesprochen", example: "Wir sprechen <span class=\"akk-bg\">Deutsch</span>.", meaning: "说(语言)", valence: "jd. spricht <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "Rad fahren", pres3: "fährt Rad", pii: "Rad gefahren*", example: "Ich fahre <span class=\"akk-bg\">Fahrrad</span>.", meaning: "骑自行车", valence: "jd. fährt Rad", category: "category3"},
    {infinitive: "halten", pres3: "hält", pii: "gehalten", example: "Halten Sie <span class=\"akk-bg\">meine Hand</span>?", meaning: "持握", valence: "jd. hält <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "waschen", pres3: "wäscht", pii: "gewaschen", example: "Ich wasche <span class=\"akk-bg\">das Auto</span>.", meaning: "洗", valence: "jd. wäscht <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "lesen", pres3: "liest", pii: "gelesen", example: "Ich lese <span class=\"akk-bg\">ein Buch</span>.", meaning: "阅读", valence: "jd. liest <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "sehen", pres3: "sieht", pii: "gesehen", example: "Sehen Sie <span class=\"akk-bg\">den Film</span>?", meaning: "看见", valence: "jd. sieht <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "nehmen", pres3: "nimmt", pii: "genommen", example: "Nehmen Sie <span class=\"akk-bg\">ein Taxi</span>!", meaning: "拿取", valence: "jd. nimmt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "essen", pres3: "isst", pii: "gegessen", example: "Ich esse <span class=\"akk-bg\">einen Apfel</span>.", meaning: "吃", valence: "jd. isst <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "treffen", pres3: "trifft", pii: "getroffen", example: "Wir treffen <span class=\"akk-bg\">unsere Freunde</span>.", meaning: "遇见", valence: "jd. trifft <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "es gibt", pres3: "es gibt", pii: "es gegeben", example: "Hier gibt es <span class=\"akk-bg\">viele Restaurants</span>.", meaning: "有/存在", valence: "es gibt <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "haben", pres3: "hat", pii: "gehabt", example: "Ich habe <span class=\"akk-bg\">ein Auto</span>.", meaning: "有", valence: "jd. hat <span class=\"akk-bg\">Akk</span>", category: "category3"},
    {infinitive: "anfangen", pres3: "fängt an", pii: "angefangen", example: "Fangen Sie <span class=\"akk-bg\">die Arbeit</span> an?", meaning: "开始", valence: "jd. fängt <span class=\"akk-bg\">Akk</span> an", category: "category3"},
    {infinitive: "abgeben", pres3: "gibt ab", pii: "abgegeben", example: "Geben Sie <span class=\"akk-bg\">die Hausaufgaben</span> ab!", meaning: "递交", valence: "jd. gibt <span class=\"akk-bg\">Akk</span> ab", category: "category3"},
    {infinitive: "einladen", pres3: "lädt ein", pii: "eingeladen", example: "Ich lade <span class=\"akk-bg\">dich</span> ein.", meaning: "邀请", valence: "jd. lädt <span class=\"akk-bg\">Akk</span> ein", category: "category3"},
    {infinitive: "mitnehmen", pres3: "nimmt mit", pii: "mitgenommen", example: "Nehmen Sie <span class=\"akk-bg\">den Regenschirm</span> mit!", meaning: "带走", valence: "jd. nimmt <span class=\"akk-bg\">Akk</span> mit", category: "category3"},
    
    // 类别4: 主语 + 动作 + (Dat)受益者 (9个)
    {infinitive: "antworten", pres3: "", pii: "", example: "Ich antworte <span class=\"dat-bg\">dir</span>.", meaning: "回答", valence: "jd. antwortet <span class=\"dat-bg\">Dat</span>", category: "category4"},
    {infinitive: "danken", pres3: "", pii: "", example: "Ich danke <span class=\"dat-bg\">Ihnen</span>.", meaning: "感谢", valence: "jd. dankt <span class=\"dat-bg\">Dat</span>", category: "category4"},
    {infinitive: "schmecken", pres3: "", pii: "", example: "Das schmeckt <span class=\"dat-bg\">mir</span>.", meaning: "尝起来", valence: "etw. schmeckt <span class=\"dat-bg\">Dat</span>", category: "category4"},
    {infinitive: "glauben", pres3: "", pii: "", example: "Ich glaube <span class=\"dat-bg\">dir</span>.", meaning: "信任", valence: "jd. glaubt <span class=\"dat-bg\">Dat</span>", category: "category4"},
    {infinitive: "gratulieren", pres3: "", pii: "", example: "Ich gratuliere <span class=\"dat-bg\">dir</span>.", meaning: "祝贺", valence: "jd. gratuliert <span class=\"dat-bg\">Dat</span>", category: "category4"},
    {infinitive: "fehlen", pres3: "", pii: "", example: "Du fehlst <span class=\"dat-bg\">mir</span>.", meaning: "缺少/想念", valence: "jd. fehlt <span class=\"dat-bg\">Dat</span>", category: "category4"},
    {infinitive: "gehören", pres3: "", pii: "", example: "Das gehört <span class=\"dat-bg\">mir</span>.", meaning: "属于", valence: "etw. gehört <span class=\"dat-bg\">Dat</span>", category: "category4"},
    {infinitive: "helfen", pres3: "hilft", pii: "geholfen", example: "Ich helfe <span class=\"dat-bg\">dir</span>.", meaning: "帮助", valence: "jd. hilft <span class=\"dat-bg\">Dat</span>", category: "category4"},
    {infinitive: "gefallen", pres3: "gefällt", pii: "gefallen", example: "Das gefällt <span class=\"dat-bg\">mir</span>.", meaning: "使喜欢", valence: "etw. gefällt <span class=\"dat-bg\">Dat</span>", category: "category4"},
    
    // 类别5: 主语 + 动作 + (Dat)受益者 + [Akk]直接宾语 (7个)
    {infinitive: "bringen", pres3: "", pii: "gebracht", example: "Bringen Sie <span class=\"dat-bg\">mir</span> <span class=\"akk-bg\">das Buch</span>!", meaning: "带来", valence: "jd. bringt <span class=\"dat-bg\">Dat</span> <span class=\"akk-bg\">Akk</span>", category: "category5"},
    {infinitive: "erklären", pres3: "", pii: "", example: "Ich erkläre <span class=\"dat-bg\">dir</span> <span class=\"akk-bg\">die Regel</span>.", meaning: "解释", valence: "jd. erklärt <span class=\"dat-bg\">Dat</span> <span class=\"akk-bg\">Akk</span>", category: "category5"},
    {infinitive: "erlauben", pres3: "", pii: "", example: "Er erlaubt <span class=\"dat-bg\">mir</span> <span class=\"akk-bg\">das</span>.", meaning: "允许", valence: "jd. erlaubt <span class=\"dat-bg\">Dat</span> <span class=\"akk-bg\">Akk</span>", category: "category5"},
    {infinitive: "erzählen", pres3: "", pii: "", example: "Erzählen Sie <span class=\"dat-bg\">mir</span> <span class=\"akk-bg\">eine Geschichte</span>!", meaning: "讲述", valence: "jd. erzählt <span class=\"dat-bg\">Dat</span> <span class=\"akk-bg\">Akk</span>", category: "category5"},
    {infinitive: "schenken", pres3: "", pii: "", example: "Ich schenke <span class=\"dat-bg\">dir</span> <span class=\"akk-bg\">ein Buch</span>.", meaning: "赠送", valence: "jd. schenkt <span class=\"dat-bg\">Dat</span> <span class=\"akk-bg\">Akk</span>", category: "category5"},
    {infinitive: "schicken", pres3: "", pii: "", example: "Ich schicke <span class=\"dat-bg\">dir</span> <span class=\"akk-bg\">eine E-Mail</span>.", meaning: "发送", valence: "jd. schickt <span class=\"dat-bg\">Dat</span> <span class=\"akk-bg\">Akk</span>", category: "category5"},
    {infinitive: "geben", pres3: "gibt", pii: "gegeben", example: "Ich gebe <span class=\"dat-bg\">dir</span> <span class=\"akk-bg\">das Buch</span>.", meaning: "给", valence: "jd. gibt <span class=\"dat-bg\">Dat</span> <span class=\"akk-bg\">Akk</span>", category: "category5"},
    {infinitive: "empfehlen", pres3: "empfiehlt", pii: "empfohlen", example: "Ich empfehle <span class=\"dat-bg\">dir</span> <span class=\"akk-bg\">das Restaurant</span>.", meaning: "推荐", valence: "jd. empfiehlt <span class=\"dat-bg\">Dat</span> <span class=\"akk-bg\">Akk</span>", category: "category5"},
    
    // 类别6: 反身动词 (主语 + 动作 + sich) (7个)
    {infinitive: "sich duschen", pres3: "", pii: "", example: "Ich dusche <span class=\"akk-bg-opacity\">mich</span>.", meaning: "淋浴", valence: "jd. duscht <span class=\"akk-bg-opacity\">sich</span>", category: "category6"},
    {infinitive: "sich baden", pres3: "", pii: "", example: "Ich bade <span class=\"akk-bg-opacity\">mich</span>.", meaning: "泡澡", valence: "jd. badet <span class=\"akk-bg-opacity\">sich</span>", category: "category6"},
    {infinitive: "sich entschuldigen", pres3: "", pii: "", example: "Ich entschuldige <span class=\"akk-bg-opacity\">mich</span>.", meaning: "道歉", valence: "jd. entschuldigt <span class=\"akk-bg-opacity\">sich</span>", category: "category6"},
    {infinitive: "sich anmelden", pres3: "", pii: "", example: "Ich melde <span class=\"akk-bg-opacity\">mich</span> an.", meaning: "报名", valence: "jd. meldet <span class=\"akk-bg-opacity\">sich</span> an", category: "category6"},
    {infinitive: "sich kümmern", pres3: "", pii: "", example: "Ich kümmere <span class=\"akk-bg-opacity\">mich</span> <span class=\"akk-bg-opacity\">um das Kind</span>.", meaning: "照顾", valence: "jd. kümmert <span class=\"akk-bg-opacity\">sich</span> [<span class=\"akk-bg-opacity\">um Akk</span>]", category: "category6"},
    {infinitive: "sich anziehen", pres3: "", pii: "", example: "Du musst <span class=\"akk-bg-opacity\">dich</span> warm anziehen.", meaning: "穿上", valence: "jd. zieht <span class=\"akk-bg-opacity\">sich</span> an", category: "category6"},
    {infinitive: "sich ausziehen", pres3: "", pii: "", example: "Ich ziehe <span class=\"akk-bg-opacity\">mich</span> aus.", meaning: "脱衣服", valence: "jd. zieht <span class=\"akk-bg-opacity\">sich</span> aus", category: "category6"},
    {infinitive: "sich freuen", pres3: "", pii: "", example: "Ich freue <span class=\"akk-bg-opacity\">mich</span> <span class=\"akk-bg-opacity\">auf Ihre Antwort</span>.", meaning: "期待/高兴", valence: "jd. freut <span class=\"akk-bg-opacity\">sich</span> [<span class=\"akk-bg-opacity\">auf/über Akk</span>]", category: "category6"},
    
    // 类别7: 情态动词 (+ 动词原形) (6个)
    {infinitive: "können", pres3: "kann", pii: "", example: "Ich kann gut schwimmen.", meaning: "能够", valence: "jd. kann <u>Verb</u>", category: "category7"},
    {infinitive: "müssen", pres3: "muss", pii: "", example: "Ich muss lernen.", meaning: "必须", valence: "jd. muss <u>Verb</u>", category: "category7"},
    {infinitive: "möchten", pres3: "möchte", pii: "", example: "Ich möchte essen.", meaning: "想要", valence: "jd. möchte <u>Verb</u>", category: "category7"},
    {infinitive: "wollen", pres3: "will", pii: "", example: "Ich will kommen.", meaning: "想要，计划", valence: "jd. will <u>Verb</u>", category: "category7"},
    {infinitive: "sollen", pres3: "soll", pii: "", example: "Ich soll arbeiten.", meaning: "应该", valence: "jd. soll <u>Verb</u>", category: "category7"},
    {infinitive: "dürfen", pres3: "darf", pii: "", example: "Du darfst jetzt gehen.", meaning: "被允许", valence: "jd. darf <u>Verb</u>", category: "category7"}
];

// 主题分类映射（根据A1词汇主题分类.txt）
const themeMapping = {
    '旅行交通': ['kommen', 'gehen', 'fahren', 'fliegen', 'reisen', 'wandern', 'steigen', 'einsteigen', 'aussteigen', 'abfahren', 'abfliegen', 'ankommen', 'mitkommen', 'weg sein', 'auf sein', 'zu sein', 'geöffnet sein', 'geschlossen sein', 'öffnen', 'schließen', 'dauern', 'enden', 'beginnen', 'anfangen', 'aufhören', 'warten', 'besichtigen', 'regnen', 'scheinen'],
    '饮食消费': ['essen', 'trinken', 'frühstücken', 'kochen', 'backen', 'grillen', 'schmecken', 'riechen', 'kaufen', 'einkaufen', 'verkaufen', 'bestellen', 'bezahlen', 'zahlen', 'kosten', 'überweisen', 'holen', 'bekommen', 'nehmen', 'anbieten', 'verdienen', 'mitbringen', 'mitnehmen', 'finden', 'brauchen', 'feiern', 'gratulieren', 'schenken', 'einladen', 'besuchen'],
    '居住卫生': ['wohnen', 'leben', 'bleiben', 'mieten', 'vermieten', 'umziehen', 'sich duschen', 'sich baden', 'waschen', 'putzen', 'sich anziehen', 'sich ausziehen', 'sich kümmern', 'rauchen', 'aufstehen', 'schlafen', 'sitzen', 'liegen', 'stehen', 'reparieren', 'aufräumen', 'ausmachen', 'anmachen', 'aufmachen', 'zumachen', 'an sein', 'aus sein'],
    '学习爱好': ['lernen', 'studieren', 'buchstabieren', 'lesen', 'schreiben', 'unterschreiben', 'wiederholen', 'üben', 'verstehen', 'wissen', 'kennen', 'bedeuten', 'erklären', 'vergessen', 'sprechen', 'antworten', 'fragen', 'hören', 'sehen', 'arbeiten', 'drucken', 'anklicken', 'ankreuzen', 'ausfüllen', 'laufen', 'schwimmen', 'wandern', 'spielen', 'fernsehen', 'Rad fahren', 'tanzen', 'gewinnen'],
    '社交情感': ['heißen', 'grüßen', 'kennen lernen', 'treffen', 'helfen', 'sagen', 'telefonieren', 'anrufen', 'lachen', 'erzählen', 'schicken', 'empfehlen', 'erlauben', 'heiraten', 'sich anmelden', 'mitmachen', 'abholen', 'lieben', 'mögen', 'gefallen', 'sich freuen', 'glauben', 'hoffen', 'wünschen', 'fehlen', 'danken', 'entschuldigen', 'bitten'],
    '其他': ['sein', 'werden', 'haben', 'es gibt', 'bekannt sein', 'besetzt sein', 'verboten sein', 'geboren sein', 'verheiratet sein', 'gestorben sein', 'aussehen', 'können', 'müssen', 'möchten', 'wollen', 'sollen', 'dürfen', 'machen', 'tun', 'legen', 'stellen', 'halten', 'geben', 'abgeben', 'bringen', 'gehören', 'benutzen', 'drücken', 'passieren']
};

// 根据主题分类重新组织动词数据
function organizeVerbsByTheme() {
    const organized = {};
    
    // 初始化主题
    Object.keys(themeMapping).forEach(theme => {
        organized[theme] = [];
    });
    
    // 将动词分配到对应主题
    allVerbs.forEach(verb => {
        // 提取动词原形（去掉sich前缀）
        const verbBase = verb.infinitive.replace(/^sich /, '').split(' ')[0];
        
        // 查找动词所属主题
        let found = false;
        for (const [theme, verbs] of Object.entries(themeMapping)) {
            if (verbs.includes(verbBase) || verbs.includes(verb.infinitive)) {
                organized[theme].push(verb);
                found = true;
                break;
            }
        }
        
        // 如果没找到，放入"其他"主题
        if (!found) {
            organized['其他'].push(verb);
        }
    });
    
    return organized;
}

// 获取当前主题的动词列表
function getCurrentThemeVerbs() {
    const currentTheme = learningProgress.currentTheme;
    if (!currentTheme) return [];
    
    const organized = organizeVerbsByTheme();
    return organized[currentTheme] || [];
}

// ==================== 学习模式 ====================

function loadCurrentTheme() {
    if (!userConfig.setupCompleted) return;

    const verbs = getCurrentThemeVerbs();
    if (!domCache.cardsContainer) {
        domCache.init();
    }

    if (!domCache.cardsContainer) {
        error('无法找到卡片容器');
        return;
    }

    renderLearningCards(verbs);
    
    // 更新底部总数统计
    if (domCache.totalCountElement) {
        domCache.totalCountElement.textContent = verbs.length;
    } else {
        // 如果缓存中没有，重新获取
        const totalCountEl = document.getElementById('total-count');
        if (totalCountEl) {
            totalCountEl.textContent = verbs.length;
            domCache.totalCountElement = totalCountEl;
        }
    }
}

function renderLearningCards(verbs) {
    if (!domCache.cardsContainer) return;

    domCache.cardsContainer.innerHTML = '';

    // 添加复习卡片
    const carryOverCards = getCarryOverMistakes();
    if (carryOverCards.length > 0) {
        const existingWords = new Set(verbs.map(item => item.infinitive));
        const uniqueCarryOvers = carryOverCards
            .filter(card => card && card.infinitive && !existingWords.has(card.infinitive))
            .map(card => ({ ...card, carryOver: true }));
        if (uniqueCarryOvers.length > 0) {
            log('追加复习卡片数量:', uniqueCarryOvers.length);
            verbs = [...verbs, ...uniqueCarryOvers];
        }
    }

    if (verbs.length === 0) {
        domCache.cardsContainer.innerHTML = '<div class="empty-state">该主题下没有动词</div>';
        return;
    }

    verbs.forEach((verb, index) => {
        // 检查是否应该隐藏卡片
        const state = cardStates[verb.infinitive];
        if (state && state.hidden) {
            return; // 跳过隐藏的卡片
        }

        const card = createLearningCard(verb, index);
        domCache.cardsContainer.appendChild(card);
    });
}

function createLearningCard(verb, index) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.verbIndex = index;
    
    const formattedVerb = formatSeparableVerb(verb.infinitive);
    const translation = generateTranslation(verb.example, verb.meaning, verb.infinitive);
    
    // 根据词条长度添加class（移动端适配）
    const verbText = formattedVerb.replace(/<[^>]*>/g, '');
    let verbNameClass = 'verb-name';
    if (verbText.length > 20) {
        verbNameClass += ' very-long-verb';
    } else if (verbText.length > 15) {
        verbNameClass += ' long-verb';
    }
    
    card.innerHTML = `
        <div class="card-inner">
            <!-- 卡片正面 -->
            <div class="card-face card-front">
                <div class="verb-header">
                    <div class="${verbNameClass}">${formattedVerb}</div>
                    <button class="speak-btn" onclick="speakWord('${verb.infinitive.replace(/'/g, "\\'")}', event)">
                        <i class="fas fa-volume-up"></i>
                    </button>
                </div>
                
                <div class="verb-forms">
                    <div class="form-item">
                        <div class="form-label">单三形式:</div>
                        <div class="form-value">${verb.pres3 || '-'}</div>
                    </div>
                    <div class="form-item">
                        <div class="form-label">过去分词:</div>
                        <div class="form-value">${verb.pii || '-'}</div>
                    </div>
                </div>
                
                <div class="verb-example">
                    ${verb.example}
                </div>
            </div>
            
            <!-- 卡片背面 -->
            <div class="card-face card-back">
                <div class="card-back-content">
                    <div class="valence">${verb.valence}</div>
                    <div class="meaning">${verb.meaning}</div>
                    <div class="example-translation">
                        ${translation}
                    </div>
                    <div class="card-hint">点击卡片返回</div>
                </div>
                <div class="learning-feedback-overlay" style="display: none;">
                    <div class="feedback-buttons">
                        <button class="feedback-btn unknown" onclick="handleLearningFeedback('${verb.infinitive.replace(/'/g, "\\'")}', 'unknown', this)">
                            <span class="icon">❌</span> 不认识
                        </button>
                        <button class="feedback-btn vague" onclick="handleLearningFeedback('${verb.infinitive.replace(/'/g, "\\'")}', 'vague', this)">
                            <span class="icon">🤔</span> 模糊
                        </button>
                        <button class="feedback-btn known" onclick="handleLearningFeedback('${verb.infinitive.replace(/'/g, "\\'")}', 'known', this)">
                            <span class="icon">✅</span> 认识
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 添加点击事件
    card.addEventListener('click', function(e) {
        if (e.target.closest('.speak-btn') || e.target.closest('.feedback-btn')) {
            e.stopPropagation();
            return;
        }
        if (this.dataset.interactionLocked === 'true') return;

        const wasFlipped = this.classList.contains('flipped');
        this.classList.toggle('flipped');

        // 处理学习反馈显示
        const feedbackOverlay = this.querySelector('.learning-feedback-overlay');
        const hintDiv = this.querySelector('.card-hint');

        if (this.classList.contains('flipped') && !wasFlipped) {
            // 翻转到背面，显示反馈
            if (feedbackOverlay) feedbackOverlay.style.display = 'flex';
            if (hintDiv) hintDiv.style.display = 'none';
        } else if (!this.classList.contains('flipped') && wasFlipped) {
            // 翻转回正面，隐藏反馈
            if (feedbackOverlay) feedbackOverlay.style.display = 'none';
            if (hintDiv) hintDiv.style.display = 'block';
        }

        lockCardInteraction(this);
    });
    
    return card;
}

// 发音功能
function speakWord(word, event) {
    if (event) {
        event.stopPropagation();
    }
    
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = 'de-DE';
        utterance.rate = 0.9;
        utterance.pitch = 1;
        
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        
        if (event) {
            const button = event.target.closest('.speak-btn');
            if (button) {
                button.innerHTML = '<i class="fas fa-volume-up fa-beat"></i>';
                setTimeout(() => {
                    button.innerHTML = '<i class="fas fa-volume-up"></i>';
                }, 1000);
            }
        }
    }
}

// ==================== 测试模式 ====================

function startTest(testType) {
    learningProgress.currentTestType = testType;
    learningProgress.currentMode = 'test';
    saveLearningProgress();
    
    const verbs = getCurrentThemeVerbs();
    if (verbs.length === 0) {
        alert('该主题下没有动词，无法开始测试');
        return;
    }
    
    // 生成测试题目
    if (testType === 'test1') {
        currentTest = generateMeaningTest(verbs);
    } else if (testType === 'test2') {
        currentTest = generateValenceTest(verbs);
    } else {
        error('未知的测试类型:', testType);
        return;
    }
    
    currentTest.type = testType;
    currentTest.theme = learningProgress.currentTheme;
    currentTest.startTime = Date.now();
    currentTest.currentIndex = 0;
    currentTest.answers = [];
    currentTest.showingFeedback = false;
    
    renderTestCard();
    updateTestProgress();
}

function generateMeaningTest(verbs) {
    const questions = [];
    const used = new Set();
    const limit = Math.min(10, verbs.length);

    // 创建带权重的单词列表
    const weightedVerbs = [];
    verbs.forEach(verb => {
        const weight = cardStates[verb.infinitive]?.weight || 1;
        for (let i = 0; i < weight; i++) {
            weightedVerbs.push(verb);
        }
    });

    while (questions.length < limit) {
        const v = weightedVerbs[Math.floor(Math.random() * weightedVerbs.length)];
        if (used.has(v.infinitive)) continue;
        used.add(v.infinitive);
        const correct = v.meaning;
        const distractors = [];
        while (distractors.length < 2) {
            const dv = verbs[Math.floor(Math.random() * verbs.length)];
            if (dv.infinitive === v.infinitive) continue;
            if (!distractors.includes(dv.meaning)) {
                distractors.push(dv.meaning);
            }
        }
        const options = shuffleArray([correct, ...distractors]);
        questions.push({
            infinitive: v.infinitive,
            example: v.example,
            correct,
            options
        });
    }
    return { type: 'test1', questions };

}

// ==================== 配价测试与题渲染 ====================

function generateValenceTest(verbs) {
    const questions = [];
    const pool = verbs.filter(v => v.category !== 'category7');
    const used = new Set();
    const limit = Math.min(8, pool.length);

    // 创建带权重的单词列表
    const weightedPool = [];
    pool.forEach(verb => {
        const weight = cardStates[verb.infinitive]?.weight || 1;
        for (let i = 0; i < weight; i++) {
            weightedPool.push(verb);
        }
    });

    while (questions.length < limit) {
        const v = weightedPool[Math.floor(Math.random() * weightedPool.length)];
        if (used.has(v.infinitive)) continue;
        used.add(v.infinitive);
        const correct = valenceOptionLabel(v);
        const distractors = [];
        const optionPool = ['N-动词','N-动词-A','N-动词-D','N-动词-D-A','N-动词-介词+A','N-动词-介词+D','N-动词-表语','N-动词-反身'];
        while (distractors.length < 3) {
            const opt = optionPool[Math.floor(Math.random() * optionPool.length)];
            if (opt === correct || distractors.includes(opt)) continue;
            distractors.push(opt);
        }
        const options = shuffleArray([correct, ...distractors]);
        questions.push({
            infinitive: v.infinitive,
            example: v.example,
            correct,
            options
        });
    }
    return { type: 'test2', questions };
}

function valenceOptionLabel(verb) {
    const v = (verb.valence || '').toLowerCase();

    // 先识别是否有介词宾语（通过透明度标记和介词关键字）
    const hasPrepAkk =
        v.includes('akk-bg-opacity') &&
        /(auf|an|in|mit|über|für|um|nach|von|zu|bei|gegen|unter|vor|hinter|neben)/.test(v);

    const hasPrepDat =
        v.includes('dat-bg-opacity') &&
        /(auf|an|in|mit|über|für|um|nach|von|zu|bei|gegen|unter|vor|hinter|neben)/.test(v);

    if (hasPrepAkk) return 'N-动词-某介词+A';
    if (hasPrepDat) return 'N-动词-某介词+D';

    // 再按类别区分主语 / 直宾 / 受益+直宾 / 反身 等
    switch (verb.category) {
        case 'category1':
            return 'N-动词';
        case 'category2':
            return 'N-动词-表语';
        case 'category3':
            return 'N-动词-A';
        case 'category4':
            return 'N-动词-D';
        case 'category5':
            return 'N-动词-D-A';
        case 'category6':
            return 'N-动词-反身';
        default:
            return 'N-动词';
    }
}

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function renderTestCard() {
    const { questions, currentIndex, type } = currentTest;
    const container = domCache.cardsContainer;
    if (!container || !questions || questions.length === 0) return;
    const q = questions[currentIndex];
    const isMeaning = type === 'test1';
    container.innerHTML = `
        <div class="test-card">
            <div class="test-meta">第 ${currentIndex + 1} / ${questions.length} 题（${isMeaning ? '请选择含义' : '配价测试'}）</div>
            <div class="test-question">
                <div class="q-verb">${formatSeparableVerb(q.infinitive)}</div>
                <div class="q-example">${q.example || ''}</div>
            </div>
            <div class="options">
                ${q.options.map(opt => `<button class="option-btn" data-value="${opt.replace(/"/g,'&quot;')}">${opt}</button>`).join('')}
            </div>
        </div>
    `;
    container.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', () => answerQuestion(btn.dataset.value));
    });
}

function answerQuestion(selected) {
    if (currentTest.showingFeedback) return;

    const q = currentTest.questions[currentTest.currentIndex];
    const correct = selected === q.correct;
    currentTest.answers.push({ correct, selected, correctAnswer: q.correct });

    // 播放音效和显示反馈
    currentTest.showingFeedback = true;
    showAnswerFeedback(correct, selected, q.correct);

    // 正确答案：短暂显示后自动进入下一题
    if (correct) {
        setTimeout(() => {
            currentTest.showingFeedback = false;
            proceedToNextQuestion();
        }, 1500);
    }
    // 错误答案：等待用户点击继续
}

function showAnswerFeedback(isCorrect, selected, correct) {
    const container = domCache.cardsContainer;
    if (!container) return;

    // 播放音效
    if (isCorrect) {
        playCorrectSound();
    } else {
        playIncorrectSound();
    }

    // 修改卡片显示，显示反馈信息
    const testCard = container.querySelector('.test-card');

    // 应用背景反馈效果到整个测试卡片
    if (isCorrect) {
        testCard.classList.add('feedback-correct');
    } else {
        testCard.classList.add('feedback-incorrect');
    }
    if (testCard) {
        const optionsDiv = testCard.querySelector('.options');
        if (optionsDiv) {
            const optionBtns = optionsDiv.querySelectorAll('.option-btn');

            optionBtns.forEach(btn => {
                // 清除之前的反馈元素
                const existingFeedback = btn.querySelector('.inline-feedback');
                if (existingFeedback) {
                    existingFeedback.remove();
                }

                if (isCorrect) {
                    // 正确答案：在正确选项行右侧显示"正确"
                    if (btn.dataset.value === selected) {
                        btn.classList.add('correct-answer');
                        const feedbackSpan = document.createElement('span');
                        feedbackSpan.className = 'inline-feedback correct';
                        feedbackSpan.innerHTML = '✅ 正确';
                        btn.appendChild(feedbackSpan);
                    }
                } else {
                    // 错误答案：在错误选项行右侧显示错误提示，在正确选项行右侧显示继续按钮
                    if (btn.dataset.value === selected) {
                        btn.classList.add('wrong-answer');
                        const feedbackSpan = document.createElement('span');
                        feedbackSpan.className = 'inline-feedback wrong';
                        feedbackSpan.innerHTML = '❌ 错误';
                        btn.appendChild(feedbackSpan);
                    } else if (btn.dataset.value === correct) {
                        btn.classList.add('correct-answer');
                        btn.classList.add('continue-enabled'); // 添加标识类
                        const continueBtn = document.createElement('button');
                        continueBtn.className = 'inline-continue-btn';
                        continueBtn.innerHTML = '继续';
                        continueBtn.onclick = function(e) {
                            e.stopPropagation(); // 阻止事件冒泡，避免触发选项选择
                            proceedToNextQuestion();
                        };
                        btn.appendChild(continueBtn);

                        // 为整个按钮添加点击事件，继续答题
                        btn.addEventListener('click', function(e) {
                            if (btn.classList.contains('continue-enabled')) {
                                e.stopPropagation();
                                proceedToNextQuestion();
                            }
                        });
                    }
                }
            });
        }
    }
}

function proceedToNextQuestion() {
    // 清除反馈状态
    currentTest.showingFeedback = false;
    const container = domCache.cardsContainer;
    if (container) {
        container.classList.remove('feedback-correct', 'feedback-incorrect');
        const testCard = container.querySelector('.test-card');
        if (testCard) {
            testCard.classList.remove('feedback-correct', 'feedback-incorrect');
        }
    }

    if (currentTest.currentIndex + 1 >= currentTest.questions.length) {
        finishTest();
    } else {
        currentTest.currentIndex += 1;
        renderTestCard();
        updateTestProgress();
    }
}

function updateTestProgress() {
    const progress = domCache.testProgress || domCache.get('test-progress');
    const instruction = domCache.testInstruction || domCache.get('test-instruction');
    if (progress) {
        progress.textContent = `${currentTest.currentIndex + 1}/${currentTest.questions.length}`;
    }
    if (instruction) {
        instruction.textContent = currentTest.type === 'test1' ? '选择正确的中文释义' : '选择正确的配价模式';
    }
}

function finishTest() {
    const total = currentTest.questions.length;
    const correctCount = currentTest.answers.filter(a => a.correct).length;
    const rate = total === 0 ? 0 : correctCount / total;

    // 在记录结果前同步复习卡
    syncCarryOverMistakesAfterTest();

    const themeData = learningProgress.themes[learningProgress.currentTheme];
    const abilityConf = testRules[userConfig.ability || 'normal'];
    const rule = abilityConf[currentTest.type] || { passRate: 0.8 };

    if (currentTest.type === 'test1') {
        themeData.test1.passRate = rate;
        themeData.test1.attempts += 1;
        if (themeData.test1.firstAttemptPassRate === null) {
            themeData.test1.firstAttemptPassRate = rate;
        }
        themeData.test1.lastAttempt = Date.now();
        
        const passed = rate >= (rule.passRate || 0.8);
        if (passed) {
            themeData.status = 'completed';
            themeData.test1.status = 'passed';
            if (rule.unlockTest2) {
                themeData.test2.status = 'available';
            }
            unlockNextTheme();
            alert(`测试通过，正确率 ${(rate*100).toFixed(0)}%`);
            switchMode('learning');
        } else {
            alert(`测试未通过，正确率 ${(rate*100).toFixed(0)}%，请再试一次`);
            themeData.status = 'learning';
            themeData.test1.status = 'available';
            switchMode('test');
            currentTest.currentIndex = 0;
            renderTestCard();
            updateTestProgress();
        }
    } else {
        themeData.test2.passRate = rate;
        themeData.test2.attempts += 1;
        themeData.test2.lastAttempt = Date.now();
        const passed = rate >= (rule.passRate || 0.7);
        if (passed) {
            themeData.test2.status = 'passed';
            themeData.status = 'completed';
            unlockNextTheme();
            alert(`配价测试通过，正确率 ${(rate*100).toFixed(0)}%`);
            switchMode('learning');
        } else {
            alert(`配价测试未通过，正确率 ${(rate*100).toFixed(0)}%，请再试一次`);
            switchMode('test');
            currentTest.currentIndex = 0;
            renderTestCard();
            updateTestProgress();
        }
    }
    saveLearningProgress();
    updateTopBarProgress();
}

function unlockNextTheme() {
    const themes = themeOrder[userConfig.userType] || [];
    const idx = themes.indexOf(learningProgress.currentTheme);
    if (idx >= 0 && idx + 1 < themes.length) {
        const next = themes[idx + 1];
        const nextData = learningProgress.themes[next];
        if (nextData && nextData.status === 'locked') {
            nextData.status = 'learning';
            nextData.test1.status = 'available';
        }
        learningProgress.currentThemeIndex = idx + 1;
        learningProgress.currentTheme = next;
    }
}

function syncCarryOverMistakesAfterTest() {
    if (!currentTest || !Array.isArray(currentTest.questions)) return;

    currentTest.questions.forEach((question, index) => {
        if (!question || !question.infinitive) return;
        const infinitive = question.infinitive;
        const answer = currentTest.answers[index];
        if (answer && answer.correct) {
            removeCarryOverMistake(infinitive);
        } else {
            // 只有当前主题的动词才会加入复习列表
            addCarryOverMistake(question);
        }
    });
}

// ==================== 主题与数据 ====================

// ==================== 安全和用户体验 ====================

// 禁用右键菜单
document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    return false;
});

// 禁用一些快捷键
document.addEventListener('keydown', function(e) {
    // 禁用F12开发者工具
    if (e.key === 'F12') {
        e.preventDefault();
        return false;
    }
    // 禁用Ctrl+Shift+I (开发者工具)
    if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        return false;
    }
    // 禁用Ctrl+U (查看源码)
    if (e.ctrlKey && e.key === 'u') {
        e.preventDefault();
        return false;
    }
});

// ==================== 学习反馈处理 ====================

function handleLearningFeedback(infinitive, feedback, button) {
    const card = button.closest('.card');
    if (!card) return;

    // 播放反馈音效
    switch (feedback) {
        case 'unknown':
            // 不认识：播放较低沉的音效
            playSound(200, 0.4, 'sawtooth');
            break;
        case 'vague':
            // 模糊：播放中等音效
            playSound(300, 0.3, 'sine');
            break;
        case 'known':
            // 认识：播放积极音效
            playSound(600, 0.3, 'sine');
            break;
    }

    // 初始化卡片状态
    if (!cardStates[infinitive]) {
        cardStates[infinitive] = { weight: 1, hidden: false };
    }

    switch (feedback) {
        case 'unknown':
            // 不认识：增加权重到2倍，移动到末尾
            cardStates[infinitive].weight = Math.max(cardStates[infinitive].weight, 2);
            moveCardToEnd(card);
            break;
        case 'vague':
            // 模糊：移动到末尾
            moveCardToEnd(card);
            break;
        case 'known':
            // 认识：临时隐藏
            cardStates[infinitive].hidden = true;
            hideCard(card);
            break;
    }

    // 保存状态
    saveCardStates();

    // 翻转回正面
    setTimeout(() => {
        card.classList.remove('flipped');
        const feedbackOverlay = card.querySelector('.learning-feedback-overlay');
        const hintDiv = card.querySelector('.card-hint');
        if (feedbackOverlay) feedbackOverlay.style.display = 'none';
        if (hintDiv) hintDiv.style.display = 'block';
    }, 300);
}

function moveCardToEnd(card) {
    const container = domCache.cardsContainer;
    if (container) {
        // 添加动画效果
        card.style.transition = 'all 0.5s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateX(-100%)';

        setTimeout(() => {
            container.appendChild(card);
            card.style.opacity = '1';
            card.style.transform = 'translateX(0)';

            setTimeout(() => {
                card.style.transition = '';
            }, 500);
        }, 300);
    }
}

function hideCard(card) {
    card.style.transition = 'all 0.5s ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.8)';

    setTimeout(() => {
        card.style.display = 'none';
    }, 500);
}

function saveCardStates() {
    setTimeout(() => {
        try {
            localStorage.setItem('cardStates', JSON.stringify(cardStates));
        } catch (e) {
            error('保存卡片状态失败:', e);
        }
    }, 0);
}

function loadCardStates() {
    try {
        const saved = localStorage.getItem('cardStates');
        if (saved) {
            cardStates = JSON.parse(saved);
        }
    } catch (e) {
        error('加载卡片状态失败:', e);
        cardStates = {};
    }
}

function resetCardStates() {
    if (!confirm('确定要重置所有卡片状态吗？这将显示所有隐藏的卡片并重置权重。')) {
        return;
    }

    cardStates = {};
    saveCardStates();

    // 重新加载当前主题
    loadCurrentTheme();
}

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', function() {
    domCache.init();
    loadUserConfig();
    loadLearningProgress();
    loadCardStates();

    // 调试信息
    if (IS_DEV) {
        console.log('Current theme:', learningProgress.currentTheme);
        console.log('Theme verbs count:', getCurrentThemeVerbs().length);
        console.log('First 5 theme verbs:', getCurrentThemeVerbs().slice(0, 5).map(v => v.infinitive));
    }

    if (!userConfig.setupCompleted) {
        showModal('setup-modal');
        return;
    }

    // 如果已经完成设置，确保顶部栏显示
    if (domCache.fixedTopBar) {
        domCache.fixedTopBar.style.display = 'flex';
    }

    if (!learningProgress || !learningProgress.themes) {
        initializeLearningProgress();
    }

    updateHeaderDescription();
    updateTopBarProgress();
    loadCurrentTheme();

    document.querySelectorAll('.top-bar-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (mode === 'learning') {
                switchMode('learning');
            } else {
                const nextType = learningProgress.currentTestType || 'test1';
                startTest(nextType);
            }
        });
    });

    document.querySelectorAll('.top-bar-theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            if (theme && learningProgress.themes[theme] && learningProgress.themes[theme].status !== 'locked') {
                learningProgress.currentTheme = theme;
                saveLearningProgress();
                loadCurrentTheme();
            }
        });
    });
});
