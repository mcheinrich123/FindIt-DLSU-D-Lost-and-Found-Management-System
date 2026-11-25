
document.addEventListener("DOMContentLoaded", () => {
    const signupForm = document.querySelector(".auth-card form");

    if (!signupForm) {
        console.error("Sign-up form was not found.");
        return;
    }

    const submitButton = signupForm.querySelector('button[type="submit"]');

    // Create an area where success and error messages will appear.
    const message = document.createElement("p");
    message.id = "signup-message";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    signupForm.appendChild(message);

    signupForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        // Get the values entered by the student.
        const fullName = document.getElementById("full-name").value.trim();
        const schoolId = document.getElementById("school-id").value.trim();
        const email = document.getElementById("email").value.trim().toLowerCase();
        const password = document.getElementById("password").value;

        // Basic frontend validation.
        if (!fullName || !schoolId || !email || !password) {
            message.textContent = "Please complete all fields.";
            return;
        }

        if (password.length < 8) {
            message.textContent = "Password must contain at least 8 characters.";
            return;
        }

        // Prevent multiple submissions.
        submitButton.disabled = true;
        submitButton.textContent = "Creating account...";
        message.textContent = "";

        try {
            // Send the registration information to Flask.
            const response = await fetch("/api/auth/signup", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    fullName: fullName,
                    schoolId: schoolId,
                    email: email,
                    password: password
                })
            });

            const result = await response.json();

            if (!response.ok) {
                const errors = {
                    missing_fields: "Please complete all required fields.",
                    weak_password: "Your password must contain at least 8 characters.",
                    user_exists: "This email or school ID is already registered.",
                    database_error: "A database error occurred. Please try again."
                };

                message.textContent =
                    errors[result.error] || "Registration failed. Please try again.";

                return;
            }

            // Registration successful.
            message.textContent = "Account created successfully! Redirecting to login...";
            message.style.color = "green";

            signupForm.reset();

            // Redirect to the login page.
            setTimeout(() => {
                window.location.href = "/login";
            }, 1500);

        } catch (error) {
            console.error("Sign-up error:", error);
            message.textContent =
                "Unable to connect to the server. Please check if Flask is running.";

        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Create account";
        }
    });
});
