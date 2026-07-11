# Hard fork: Agentic OS -> swholmes/simon-os (no tokens, no upstream tracking)

# 1. Your private repo
gh repo create swholmes/simon-os --private

# 2. Clone from the local Simon copy (keeps full history, fast, no network)
git clone C:\Users\swhol\Documents\Github\Simon\agentic-os C:\Users\swhol\Documents\Github\simon-os
cd C:\Users\swhol\Documents\Github\simon-os

# 3. Single remote: yours. No upstream, no token anywhere.
git remote remove origin
git remote add origin https://github.com/swholmes/simon-os.git

# 4. Push + baseline tag (plan gate G5)
git push -u origin main
git tag pre-starfish-baseline
git push origin pre-starfish-baseline
