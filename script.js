/**
 * Loads an SVG file and injects it into a target element, removing inline fill/width/height.
 * @param {string} svgPath - Path to the SVG file.
 * @param {HTMLElement} targetElement - The element to load the SVG into.
 */
async function loadSVG(svgPath, targetElement) {
    try {
        const response = await fetch(svgPath);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const svgText = await response.text();
        targetElement.innerHTML = svgText;

        const svgElement = targetElement.querySelector("svg");
        if (svgElement) {
            svgElement.querySelectorAll("[fill]").forEach((el) => {
                el.removeAttribute("fill");
            });

            svgElement.removeAttribute("width");
            svgElement.removeAttribute("height");
        }
    } catch (error) {
        console.error(`Error loading SVG from ${svgPath}:`, error);
    }
}

// --- Scroll-Linked Sticky Panel Logic ---

// Flag for requestAnimationFrame optimization
let rafScheduled = false;

/**
 * Initializes the states of the sticky panels for scroll-linked animation ("scrubbing").
 * Sets appropriate initial transform and z-index directly via inline styles.
 * REMINDER: Ensure the corresponding CSS *removes* the `transition` property from `.panel`
 * and state classes like .active, .revealed etc. are removed if no longer needed.
 */
function initializePanelStatesScrub() {
    const panels = document.querySelectorAll('.sticky-content .panel');
    if (!panels || panels.length === 0) {
        console.log("Sticky panels not found for scrub initialization.");
        return;
    }
    console.log("Initializing panel states for scrubbing.");

    panels.forEach((panel, index) => {
        // Preserve existing classes like .panel-1, .panel-2, etc.
        const panelClass = Array.from(panel.classList).find(cls => cls.startsWith('panel-'));
        panel.className = panelClass ? `panel ${panelClass}` : 'panel';

        panel.style.transform = '';
        panel.style.zIndex = '';

        if (index === 0) {
            panel.style.transform = 'translateY(0%)';
            panel.style.zIndex = 1;
        } else {
            panel.style.transform = 'translateY(100%)';
            panel.style.zIndex = 1;
        }

        if (panel._exitTimeout) {
            clearTimeout(panel._exitTimeout);
            panel._exitTimeout = null;
        }
    });
}

/**
 * Applies the calculated transform and z-index styles to panels based on scroll progress.
 * Called inside requestAnimationFrame.
 * @param {NodeListOf<Element>} panels - The panel elements.
 * @param {number} numPanels - The total number of panels.
 * @param {number} progress - The overall scroll progress (0-1).
 */
function updatePanelStylesForScrub(panels, numPanels, progress) {
    // Determine which transition we are in (0 means panel 0 -> 1, 1 means panel 1 -> 2, etc.)
    // Ensure calculation works even if progress is exactly 1
    const transitionIndex = Math.min(Math.floor(progress * (numPanels - 1)), numPanels - 2);

    // Determine the index of the panel being covered (current panel)
    const panelIndexCovered = Math.min(transitionIndex, numPanels - 1);

    // Determine the index of the panel being revealed (next panel)
    const panelIndexRevealing = Math.min(panelIndexCovered + 1, numPanels - 1);

    // Calculate the progress within the current transition segment (0 to 1)
    let progressInSegment = 0;
    // Avoid division by zero if numPanels is 1 or less (though handled earlier)
    const numSegments = numPanels - 1;
    if (numSegments > 0) {
        const segmentDuration = 1 / numSegments;
        const startOfSegment = panelIndexCovered * segmentDuration;
        // Ensure startOfSegment doesn't cause issues if progress is tiny
        if (segmentDuration > 0) {
            progressInSegment = (progress - startOfSegment) / segmentDuration;
        }
        // Handle precision issues near 1
        if (progress >= 1.0) {
            progressInSegment = 1.0;
        }
         progressInSegment = Math.max(0, Math.min(1, progressInSegment)); // Clamp 0-1

    } else if (progress >= 1.0) {
         // Only one panel, or progress is 1
         progressInSegment = 1.0;
    }


    // --- Apply Styles Directly ---
    panels.forEach((panel, index) => {
        let translateY = '100%'; // Default: hidden below
        let zIndex = 1;      // Default: base stacking

        if (index < panelIndexCovered) {
            // Panels fully revealed and behind the current one
            translateY = '0%';
            zIndex = index + 1; // Stack them naturally
        } else if (index === panelIndexCovered) {
             // Panel currently being covered (unless it's the last one and fully revealed)
             translateY = '0%';
             // If it's the last panel and progress is 1, it should be on top
             if (index === numPanels -1 && progress >= 1.0) {
                 zIndex = numPanels + 1; // Ensure last panel is on top when fully scrolled
             } else {
                 zIndex = index + 1; // Just above the ones behind it
             }

        } else if (index === panelIndexRevealing) {
            // Panel currently sliding into view
            // TranslateY goes from 100% (progressInSegment=0) to 0% (progressInSegment=1)
            const yValue = 100 * (1 - progressInSegment);
            translateY = `${yValue}%`;
            zIndex = index + 1; // On top of the panel being covered
        }
        // Else: Panels not yet revealed (index > panelIndexRevealing)
        // They keep the default translateY = '100%' and zIndex = 1 (or index + 1 if preferred)
        // Let's use index + 1 for consistency in stacking order even for hidden panels
        else {
             translateY = '100%';
             zIndex = index + 1;
        }


        // Apply the calculated styles
        panel.style.transform = `translateY(${translateY})`;
        panel.style.zIndex = zIndex;
    });
}


/**
 * Handles the triggering of panel style updates based on scroll, using rAF.
 */
function handleStickyPanelScrub() {
    const stickyContainer = document.querySelector('.sticky-container');
    if (!stickyContainer) return;

    const panels = stickyContainer.querySelectorAll('.sticky-content .panel');
    const numPanels = panels.length;
    if (numPanels <= 1) return; // No scrubbing needed

    const containerRect = stickyContainer.getBoundingClientRect();
    const containerHeight = stickyContainer.offsetHeight;
    const viewportHeight = window.innerHeight; // Use window's height

    // Calculate Overall Progress (0 to 1)
    let progress = 0;
    if (containerRect.top <= 0 && containerRect.bottom >= viewportHeight) {
        // Avoid division by zero if containerHeight equals viewportHeight
        const scrollableDist = containerHeight - viewportHeight;
        if (scrollableDist > 0) {
             progress = (-containerRect.top) / scrollableDist;
             progress = Math.max(0, Math.min(1, progress));
        } else {
             progress = containerRect.top <= 0 ? 1 : 0; // Handle edge case where container is exactly viewport height
        }
    } else if (containerRect.top > 0) {
        progress = 0;
    } else {
        progress = 1;
    }

    // Schedule Style Update with requestAnimationFrame
    if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(() => {
            // Pass necessary info to the style update function
            updatePanelStylesForScrub(panels, numPanels, progress);
            rafScheduled = false; // Ready for next frame
        });
    }
}

// --- Main Execution ---

document.addEventListener("DOMContentLoaded", function () {
    console.log("DOM fully loaded and parsed"); // Debugging

    // --- Initialize SVG Loading ---
    document.querySelectorAll(".svg-plus").forEach((element) => {
        loadSVG("./assets/plus.svg", element);
    });
    document.querySelectorAll(".svg-asterisk").forEach((element) => {
        loadSVG("./assets/asterisk.svg", element);
    });

    // --- Element References ---
    const container = document.querySelector(".container"); // Main scroll container
    const navbar = document.querySelector(".navbar");
    const secondSection = document.querySelector(".section.two");
    const sectionTwoElements = document.querySelectorAll(".section.two .section-title > *");
    const filler2 = document.querySelector(".filler2");
    const sectionThree = document.querySelector(".section.three");
    const cardContainer = document.querySelector(".card-container");
    const sectionThreeTitle = document.querySelector(".section.three .section-title");
    const sectionThreeAsterisk = document.querySelector(".section.three .section-title .svg-asterisk");
    const labels = document.querySelectorAll(".section.three .cards label");

    // --- Initialize Sticky Panels (Using the NEW Scrub Function) ---
    // NOTE: This replaces initializePanelStates()
    initializePanelStatesScrub();

    // --- Combined Scroll Listener Logic ---
    if (container) {
        // Initialize scroll position tracking (used for other effects maybe)
        let lastScrollY = container.scrollTop;

        const combinedScrollHandler = () => {
            const scrollPosition = container.scrollTop;
            // Keep scroll direction detection if needed for other effects
            const currentScrollDirection = scrollPosition > lastScrollY ? 'down' : 'up';
            lastScrollY = scrollPosition;

            // --- Original Scroll Logic ---
            // 1. Rotate SVGs
            document.querySelectorAll(".section.one .svg-container .svg-plus").forEach((element) => {
                const rotation = scrollPosition / 2;
                element.style.transform = `rotate(${rotation}deg)`;
            });
            document.querySelectorAll(".section.one .svg-container .svg-asterisk").forEach((element) => {
                const rotation = scrollPosition / 10;
                element.style.transform = `rotate(${rotation}deg)`;
            });

            // 2. Handle navbar visibility
            if (navbar && secondSection) {
                const secondSectionTop = secondSection.getBoundingClientRect().top;
                if (secondSectionTop <= 0) {
                    navbar.classList.add("invisible");
                } else {
                    navbar.classList.remove("invisible");
                }
            }

            // --- NEW: Handle Sticky Panel Scrubbing ---
            // NOTE: This replaces handleStickyPanelScroll(currentScrollDirection)
            handleStickyPanelScrub();
        };

        // Attach the single, combined listener
        container.addEventListener("scroll", combinedScrollHandler);

        // Call handler once on load to set initial state correctly after layout
        setTimeout(combinedScrollHandler, 0);

    } else {
        console.warn(".container element not found. Scroll functionalities inactive.");
        // Optional fallback for window scroll if needed
    }

    // --- Intersection Observer Logic (Existing - Unchanged) ---
    if (sectionTwoElements.length > 0) {
        const observer = new IntersectionObserver(
            (entries) => { entries.forEach((entry) => { entry.target.classList.toggle("fade-in", entry.isIntersecting); }); },
            { threshold: 0.8 }
        );
        sectionTwoElements.forEach((element) => observer.observe(element));
    }
    if (filler2 && secondSection) {
        const observer2 = new IntersectionObserver(
            (entries) => { entries.forEach((entry) => { filler2.classList.toggle("active", entry.isIntersecting); }); },
            { threshold: 0.79 }
        );
        observer2.observe(secondSection);
    }
    if (sectionThree && cardContainer) {
        cardContainer.style.opacity = "0"; cardContainer.style.transform = "translateY(20px)";
        const observer3 = new IntersectionObserver(
            (entries) => { entries.forEach((entry) => { if (entry.isIntersecting) { setTimeout(() => { cardContainer.style.opacity = "1"; cardContainer.style.transform = "translateY(0)"; }, 1200); } else { cardContainer.style.opacity = "0"; cardContainer.style.transform = "translateY(20px)"; } }); },
            { threshold: 0 }
        );
        observer3.observe(sectionThree);
        const observer4 = new IntersectionObserver(
            (entries) => { entries.forEach((entry) => { cardContainer.classList.toggle("fade-in", entry.isIntersecting); }); },
            { threshold: 0.8 }
        );
        observer4.observe(cardContainer);
    }
    if (sectionThreeTitle) {
        const observer5 = new IntersectionObserver(
            (entries) => { entries.forEach((entry) => { sectionThreeTitle.classList.toggle("fade-in", entry.isIntersecting); }); },
            { threshold: 0.8 }
        );
        observer5.observe(sectionThreeTitle);
    }

    // --- Click Listener for Section Three Asterisk Rotation (Existing - Unchanged) ---
    if (sectionThreeAsterisk && labels.length > 0) {
        let currentIndex = 0;
        labels.forEach((label, index) => { if (label.control && label.control.checked) { currentIndex = index; } });
        let rotation = 0;
        labels.forEach((label, index) => {
            label.addEventListener("click", () => {
                if (index > currentIndex) { rotation += 35; } else if (index < currentIndex) { rotation -= 35; }
                sectionThreeAsterisk.style.transform = `rotate(${rotation}deg)`;
                currentIndex = index;
            });
        });
    }

}); // End DOMContentLoaded

document.addEventListener("DOMContentLoaded", () => {
    const textBoxes = document.querySelectorAll(".section.five .text-box");

    const observerOptions = {
        root: null, // Use the viewport as the root
        rootMargin: "0px", // No margin
        threshold: 1, // Trigger when 50% of the element is visible
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("active"); // Add the active class
            } else {
                entry.target.classList.remove("active"); // Remove the active class
            }
        });
    }, observerOptions);

    textBoxes.forEach((box) => observer.observe(box));
});