// KN: where MuPiBox Kids Next comes from - its own repository. The app loads nothing from the original MuPiBox
// (splitti/MuPiBox): its releases are made for an image of their own with an older Debian and would replace Kids Next.

export const KN_REPO = 'daschmidt1994/mupibox-kids-next'
/** the development branch (the "Entwicklung" channel) */
export const KN_BRANCH = 'kids-next'
export const KN_RAW = `https://raw.githubusercontent.com/${KN_REPO}/${KN_BRANCH}`
export const KN_API = `https://api.github.com/repos/${KN_REPO}`
/** what kidsnext/install.sh wrote at its end: {version, mode, date, ref, commit} */
export const KN_INSTALLED_JSON = '/var/lib/mupibox-kn/installed.json'
