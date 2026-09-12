console.log("[HISNet ext] service worker loaded"); // 콘솔창에서 정상적으로 log 가 뜨는지 확인

async function decodeEucKr(response){ //utf-8 한글 깨짐 방지
    const buffer = await response.arrayBuffer();
    return new TextDecoder("euc-kr").decode(buffer);
}

async function fetchLoginFieldNames(){ // 로그인 필드 명 확인 
    const res = await fetch ("https://hisnet.handong.edu/login/login.php");
    const html = await decodeEucKr(res);

    const idMatch = html.match(/name="(id_\d+)"/);
    const pwMatch = html.match(/name="(password_\d+)"/);

    if (!idMatch || !pwMatch){
        throw new Error("로그인 필드명을 찾지 못했습니다 - 사이트 구조 변경 가능성 있음")
    }

    return { idField: idMatch[1], passwordField: pwMatch[1]}; //로그인 필드는 매 접속요청마다 바뀌므로 고정이 아닌 매회마다 새롭게 변경해야함

}

async function loginToHisnet(id, password){
    const {idField, passwordField} = await fetchLoginFieldNames();

    const body = new URLSearchParams(
    {
        part: "",
        f_name: "",
        agree: "",
        Language: "Korean",
        [idField]: id,
        [passwordField]: password,
        x: "1",
        y: "1",
    }
    );

    const res = await fetch("https://hisnet.handong.edu/login/_login.php",{
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        credentials: "include",
    });

    const html = await decodeEucKr(res);

    if (html.includes("document.location.href")){
        return { success: true, message: "로그인성공"};
    }

    const alertMatch = html.match(/alert\("([^"]*)"\)/);
    return {
    success: false,
    message: alertMatch ? alertMatch[1] : "로그인 실패 (원인 불명 — 응답 본문 확인 필요)",
  };


}

