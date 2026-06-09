import os
import zipfile
import json
import shutil

# --- UNIVERSAL CONFIG ---
EXCLUDE_LIST = [
    "compile.py", "compile.bat", ".git", ".vscode", "CONCEPT.md", 
    "README.md", ".gitignore", "implementation_plan.md", "task.md",
    "walkthrough.md", "universal_compiler_plan.md"
]

def get_mod_name():
    return os.path.basename(os.getcwd())

def increment_version(manifest_path):
    if not os.path.exists(manifest_path):
        return None
    try:
        with open(manifest_path, 'r') as f:
            data = json.load(f)
        
        version = [1, 0, 0]
        if "header" in data and "version" in data["header"]:
            version = data["header"]["version"]
            if isinstance(version, list) and len(version) >= 3:
                version[2] += 1
        
        data["header"]["version"] = version
        if "modules" in data:
            for module in data["modules"]:
                module["version"] = version
        
        with open(manifest_path, 'w') as f:
            json.dump(data, f, indent=4)
        return version
    except Exception as e:
        print(f"Error updating {manifest_path}: {e}")
        return None

def is_behavior_pack(manifest_data):
    if "modules" in manifest_data:
        for module in manifest_data["modules"]:
            if module.get("type") in ["data", "script"]:
                return True
    return False

def is_resource_pack(manifest_data):
    if "modules" in manifest_data:
        for module in manifest_data["modules"]:
            if module.get("type") == "resources":
                return True
    return False

def zip_pack(folder_path, output_name, is_root=False):
    with zipfile.ZipFile(output_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
        if is_root:
            for root, dirs, files in os.walk(folder_path):
                # Skip excluded directories
                dirs[:] = [d for d in dirs if d not in EXCLUDE_LIST]
                for file in files:
                    if file in EXCLUDE_LIST: continue
                    if file == output_name: continue
                    abs_path = os.path.join(root, file)
                    rel_path = os.path.relpath(abs_path, folder_path)
                    zipf.write(abs_path, rel_path)
        else:
            for root, dirs, files in os.walk(folder_path):
                for file in files:
                    abs_path = os.path.join(root, file)
                    rel_path = os.path.relpath(abs_path, folder_path)
                    zipf.write(abs_path, rel_path)

def main():
    mod_name = get_mod_name()
    print(f"--- Compiling Mod: {mod_name} ---")
    
    packs = []
    
    # Check root for manifest
    if os.path.exists("manifest.json"):
        with open("manifest.json", 'r') as f:
            data = json.load(f)
        pack_type = "BP" if is_behavior_pack(data) else ("RP" if is_resource_pack(data) else "Pack")
        packs.append({"path": ".", "type": pack_type, "is_root": True, "manifest": "manifest.json"})
    
    # Check subfolders for manifest
    for entry in os.scandir():
        if entry.is_dir() and entry.name not in EXCLUDE_LIST:
            m_path = os.path.join(entry.path, "manifest.json")
            if os.path.exists(m_path):
                with open(m_path, 'r') as f:
                    data = json.load(f)
                pack_type = "BP" if is_behavior_pack(data) else ("RP" if is_resource_pack(data) else "Pack")
                packs.append({"path": entry.path, "type": pack_type, "is_root": False, "manifest": m_path})

    if not packs:
        print("No manifest.json found!")
        return

    generated_files = []
    for pack in packs:
        v = increment_version(pack["manifest"])
        v_str = ".".join(map(str, v)) if v else "1.0.0"
        pack_name = f"{mod_name}_{pack['type']}_{v_str}.mcpack" if pack["type"] != "Pack" else f"{mod_name}_{v_str}.mcpack"
        print(f"Packaging {pack['type']} ({pack['path']}) -> {pack_name}")
        zip_pack(pack["path"], pack_name, pack["is_root"])
        generated_files.append(pack_name)

    if len(generated_files) > 1:
        addon_name = f"{mod_name}.mcaddon"
        print(f"Combining into {addon_name}...")
        with zipfile.ZipFile(addon_name, 'w', zipfile.ZIP_DEFLATED) as addon:
            for f in generated_files:
                addon.write(f, f)
        # Clean up individual mcpacks if combined
        for f in generated_files:
            os.remove(f)
        print(f"\nSUCCESS! Created: {addon_name}")
    elif len(generated_files) == 1:
        print(f"\nSUCCESS! Created: {generated_files[0]}")

if __name__ == "__main__":
    main()
