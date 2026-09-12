console.log("[HISNet ext] service worker loaded");

async function decodeEucKr(response){
    const buffer = await response.arrayBuffer();
    return new TextDecoder("euc-kr").decode(buffer);
}

async function fetchLoginFieldNames(){
    const res = await fetch ("https://hisnet.handong.edu/login/login.php");
    const html = await decodeEucKr(res);

    const idMatch = html.match(/name="(id_\d+)"/);
    const pwMatch = html.match(/name="(password_\d+)"/);

    if (!idMatch || !pwMatch){
        throw new Error("로그인 필드명을 찾지 못했습니다 - 사이트 구조 변경 가능성 있음")
    }

    return { idField: idMatch[1], passwordField: pwMatch[1]};

}

